import { spawn, type SpawnOptions } from "node:child_process";
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import type { SshWorkspaceRef } from "../workspace/workspaceRef.js";
import { formatWorkspaceRef, sshDestination } from "../workspace/workspaceRef.js";
import { posixQuote } from "./remoteQuote.js";
import {
  defaultSshControlDir,
  sshClientFlags,
  type OpenSshOptions,
  type SpawnLike,
} from "./openSsh.js";

export function sshfsRemoteSpec(ref: SshWorkspaceRef): string {
  return `${sshDestination(ref)}:${ref.remotePath}`;
}

function workspaceKey(ref: SshWorkspaceRef): string {
  return createHash("sha1").update(formatWorkspaceRef(ref)).digest("hex").slice(0, 16);
}

export function sshfsMountDir(ref: SshWorkspaceRef): string {
  return join(homedir(), ".winnow", "ssh-mounts", workspaceKey(ref));
}

export function sshfsSshWrapperPath(ref: SshWorkspaceRef, controlDir?: string): string {
  return join(controlDir ?? defaultSshControlDir(), `sshfs-${workspaceKey(ref)}.sh`);
}

/** OpenSSH flags live in this script so FUSE `-o` never sees commas or `-p`. */
export function sshfsSshWrapperScript(
  ref: SshWorkspaceRef,
  opts?: { controlDir?: string; passwordAuth?: boolean },
): string {
  const flags = sshClientFlags(ref, opts).map(posixQuote).join(" ");
  return `#!/bin/sh\nexec ssh ${flags} "$@"\n`;
}

export async function writeSshfsSshWrapper(
  ref: SshWorkspaceRef,
  opts?: { controlDir?: string; passwordAuth?: boolean },
): Promise<string> {
  const controlDir = opts?.controlDir ?? defaultSshControlDir();
  await mkdir(controlDir, { recursive: true, mode: 0o700 });
  const path = sshfsSshWrapperPath(ref, controlDir);
  await writeFile(path, sshfsSshWrapperScript(ref, opts), { encoding: "utf8", mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

export function buildSshfsArgv(
  ref: SshWorkspaceRef,
  mountPoint: string,
  opts?: { controlDir?: string; passwordAuth?: boolean; sshCommand?: string },
): string[] {
  const sshCommand = opts?.sshCommand ?? "ssh";
  const args = [sshfsRemoteSpec(ref), mountPoint, "-o", "reconnect", "-o", `ssh_command=${sshCommand}`];
  if (platform() === "darwin") {
    args.push("-o", `volname=Winnow-${ref.host.replace(/[^A-Za-z0-9._-]+/g, "-")}`);
  }
  return args;
}

export async function whichSshfs(spawnFn?: SpawnLike): Promise<string | null> {
  return new Promise((resolve) => {
    const run = (spawnFn ?? spawn) as SpawnLike;
    const child = run(platform() === "win32" ? "where" : "which", ["sshfs"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout?.on("data", (buf: Buffer) => {
      stdout += buf.toString("utf8");
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      const line = stdout.trim().split("\n")[0]?.trim();
      resolve(code === 0 && line ? line : null);
    });
  });
}

export async function isMountPoint(dir: string): Promise<boolean> {
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) {
      return false;
    }
    const parent = await stat(dirname(dir));
    return info.dev !== parent.dev;
  } catch {
    return false;
  }
}

function runCommand(
  command: string,
  args: string[],
  options: { spawnFn?: SpawnLike; extraEnv?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const spawnFn = (options.spawnFn ?? spawn) as SpawnLike;
  const timeoutMs = options.timeoutMs ?? 25_000;
  return new Promise((resolvePromise) => {
    const child = spawnFn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...options.extraEnv },
    } as SpawnOptions);
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGKILL");
      resolvePromise({ ok: false, stdout, stderr: stderr || `${command} timed out` });
    }, timeoutMs);
    child.stdout?.on("data", (buf: Buffer) => {
      stdout += buf.toString("utf8");
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolvePromise({ ok: false, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolvePromise({ ok: code === 0, stdout, stderr });
    });
  });
}

export async function mountSshfs(
  ref: SshWorkspaceRef,
  options: OpenSshOptions & { mountPoint?: string } = {},
): Promise<{ ok: true; mountPoint: string } | { ok: false; error: string }> {
  const sshfsPath = await whichSshfs(options.spawnFn);
  if (!sshfsPath) {
    return {
      ok: false,
      error:
        "sshfs is not installed on this machine. Winnow runs local cursor-agent against a mounted remote folder. Install macFUSE + sshfs (macOS) or sshfs (Linux), then reconnect.",
    };
  }
  const mountPoint = options.mountPoint ?? sshfsMountDir(ref);
  await mkdir(mountPoint, { recursive: true, mode: 0o700 });
  if (await isMountPoint(mountPoint)) {
    return { ok: true, mountPoint };
  }
  const controlDir = options.controlDir ?? defaultSshControlDir();
  const sshCommand = await writeSshfsSshWrapper(ref, {
    controlDir,
    passwordAuth: options.passwordAuth,
  });
  const argv = buildSshfsArgv(ref, mountPoint, {
    controlDir,
    passwordAuth: options.passwordAuth,
    sshCommand,
  });
  const mounted = await runCommand(sshfsPath, argv, {
    spawnFn: options.spawnFn,
    extraEnv: options.extraEnv,
    timeoutMs: 25_000,
  });
  if (!mounted.ok && !(await isMountPoint(mountPoint))) {
    const detail = (mounted.stderr || mounted.stdout).trim() || "sshfs failed";
    return { ok: false, error: `Could not mount remote folder: ${detail}` };
  }
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await isMountPoint(mountPoint)) {
      return { ok: true, mountPoint };
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (await isMountPoint(mountPoint)) {
    return { ok: true, mountPoint };
  }
  return { ok: false, error: "sshfs started but the mount point did not become ready." };
}

export async function unmountSshfs(
  mountPoint: string,
  options: { spawnFn?: SpawnLike } = {},
): Promise<void> {
  if (!(await isMountPoint(mountPoint))) {
    return;
  }
  const spawnFn = options.spawnFn;
  if (platform() === "linux") {
    const fused = await runCommand("fusermount", ["-u", mountPoint], { spawnFn, timeoutMs: 8_000 });
    if (fused.ok) {
      return;
    }
  }
  await runCommand("umount", [mountPoint], { spawnFn, timeoutMs: 8_000 });
}
