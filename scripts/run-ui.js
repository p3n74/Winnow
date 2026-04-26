#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const extraArgs = process.argv.slice(2);

function nodeMajor() {
  return Number.parseInt(process.versions.node.split(".")[0], 10);
}

function ensureNodeVersion() {
  const major = nodeMajor();
  if (Number.isFinite(major) && major >= 20 && major < 23) {
    return true;
  }
  process.stderr.write(`[winnow-ui] ERROR: Node ${process.version} is unsupported (need >=20 and <23).\n`);
  process.stderr.write("[winnow-ui] Run: npm run setup\n");
  return false;
}

function npmCmd() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npxCmd() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function runPtyCheck() {
  return spawnSync(process.execPath, [path.join(root, "scripts", "pty-check.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}

function rebuildPty() {
  process.stdout.write("[winnow-ui] Rebuilding node-pty for this system...\n");
  return spawnSync(npmCmd(), ["rebuild", "node-pty", "--build-from-source"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
}

if (!ensureNodeVersion()) {
  process.exit(1);
}

let check = runPtyCheck();
if (check.status !== 0) {
  rebuildPty();
  check = runPtyCheck();
  if (check.status !== 0) {
    process.stderr.write("[winnow-ui] ERROR: node-pty still failed after rebuild.\n");
    process.stderr.write("[winnow-ui] Run: npm run setup\n");
    process.exit(1);
  }
}

process.stdout.write(`[winnow-ui] using node ${process.version}\n`);

const ui = spawnSync(npxCmd(), ["tsx", path.join("src", "cli", "index.ts"), "ui", ...extraArgs], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
process.exit(ui.status === null ? 1 : ui.status);
