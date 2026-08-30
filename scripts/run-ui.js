#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isNativeAbiMismatch, NATIVE_PACKAGES, pathWithRunningNode } from "./nativeAbi.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const extraArgs = process.argv.slice(2);

function nodeMajor() {
  return Number.parseInt(process.versions.node.split(".")[0], 10);
}

function ensureNodeVersion() {
  const major = nodeMajor();
  if (Number.isFinite(major) && major >= 22) {
    return true;
  }
  process.stderr.write(`[winnow-ui] ERROR: Node ${process.version} is unsupported (need Node 22 or newer).\n`);
  process.stderr.write("[winnow-ui] Run: npm run setup\n");
  return false;
}

function runningNodeEnv() {
  return {
    ...process.env,
    PATH: pathWithRunningNode(process.env.PATH || "", process.execPath, path.delimiter),
  };
}

function siblingBin(name) {
  const ext = process.platform === "win32" ? ".cmd" : "";
  const candidate = path.join(path.dirname(process.execPath), `${name}${ext}`);
  return existsSync(candidate) ? candidate : name;
}

function runScript(scriptName) {
  return spawnSync(process.execPath, [path.join(root, "scripts", scriptName)], {
    cwd: root,
    encoding: "utf8",
    env: runningNodeEnv(),
  });
}

function combinedOutput(result) {
  return `${result.stderr || ""}${result.stdout || ""}`;
}

function nativesReady() {
  const abi = runScript("native-modules-check.mjs");
  if (abi.status !== 0) {
    return { ok: false, output: combinedOutput(abi) };
  }
  const pty = runScript("pty-check.mjs");
  if (pty.status !== 0) {
    return { ok: false, output: combinedOutput(pty) };
  }
  return { ok: true, output: "" };
}

function spawnInherited(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: runningNodeEnv(),
    // .cmd shims (npm/npx) cannot be spawned without a shell on Windows.
    shell: process.platform === "win32",
  });
  if (result.error) {
    process.stderr.write(`[winnow-ui] failed to spawn ${command}: ${result.error.message}\n`);
  }
  return result;
}

function rebuildNativeModules() {
  process.stdout.write(
    `[winnow-ui] Rebuilding ${NATIVE_PACKAGES.join(", ")} for Node ${process.version}...\n`,
  );
  return spawnInherited(siblingBin("npm"), ["rebuild", ...NATIVE_PACKAGES]);
}

function ensureNativeModules() {
  let ready = nativesReady();
  if (ready.ok) {
    return true;
  }

  if (isNativeAbiMismatch(ready.output)) {
    process.stdout.write(
      `[winnow-ui] Native addons were built for a different Node.js than ${process.version}.\n`,
    );
  } else if (ready.output.trim()) {
    process.stderr.write(ready.output);
  }

  rebuildNativeModules();
  ready = nativesReady();
  if (ready.ok) {
    return true;
  }

  process.stderr.write("[winnow-ui] ERROR: native modules still failed after rebuild.\n");
  if (ready.output.trim()) {
    process.stderr.write(ready.output);
    if (!ready.output.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }
  process.stderr.write("[winnow-ui] Install a C++ toolchain (Xcode CLT or Visual Studio Build Tools), then retry.\n");
  return false;
}

if (!ensureNodeVersion()) {
  process.exit(1);
}

if (!ensureNativeModules()) {
  process.exit(1);
}

process.stdout.write(`[winnow-ui] using node ${process.version}\n`);

const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const uiEntry = path.join("src", "cli", "index.ts");
const ui = existsSync(tsxCli)
  ? spawnSync(process.execPath, [tsxCli, uiEntry, "ui", ...extraArgs], {
      cwd: root,
      stdio: "inherit",
      env: runningNodeEnv(),
    })
  : spawnInherited(siblingBin("npx"), ["tsx", uiEntry, "ui", ...extraArgs]);
if (ui.error) {
  process.stderr.write(`[winnow-ui] failed to start UI: ${ui.error.message}\n`);
}
process.exit(ui.status === null ? 1 : ui.status);
