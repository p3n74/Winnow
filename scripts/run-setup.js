#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform === "win32") {
  const ps = path.join(root, "scripts", "setup.ps1");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps],
    { stdio: "inherit", cwd: root, env: process.env },
  );
  process.exit(result.status === null ? 1 : result.status);
}

const sh = path.join(root, "scripts", "setup.sh");
const result = spawnSync("bash", [sh], { stdio: "inherit", cwd: root, env: process.env });
process.exit(result.status === null ? 1 : result.status);
