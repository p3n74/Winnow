import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SshWorkspaceRef } from "../workspace/workspaceRef.js";
import { remoteCdAndExec, remoteGitAt, remotePathExpr } from "./remoteQuote.js";
import { sshDestination } from "../workspace/workspaceRef.js";

export type SpawnLike = (
  command: string,
  args: readonly string[],
  options?: SpawnOptions,
) => ChildProcess;

export type SshExecResult = {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
};

export type OpenSshOptions = {
  spawnFn?: SpawnLike;
  controlDir?: string;
  connectTimeoutSec?: number;
  /** When set, skip BatchMode and merge SSH_ASKPASS env from an askpass session. */
  passwordAuth?: boolean;
  extraEnv?: Record<string, string>;
};

const DEFAULT_CONNECT_TIMEOUT_SEC = 12;

export function defaultSshControlDir(): string {
  return join(homedir(), ".winnow", "ssh");
}

export function sshClientFlags(
  ref: SshWorkspaceRef,
  opts?: { controlDir?: string; connectTimeoutSec?: number; passwordAuth?: boolean },
): string[] {
  const controlDir = opts?.controlDir ?? defaultSshControlDir();
  const timeout = opts?.connectTimeoutSec ?? DEFAULT_CONNECT_TIMEOUT_SEC;
  const args: string[] = [
    "-o",
    opts?.passwordAuth ? "NumberOfPasswordPrompts=1" : "BatchMode=yes",
    "-o",
    `ConnectTimeout=${timeout}`,
    "-o",
    "ControlMaster=auto",
    "-o",
    `ControlPath=${join(controlDir, "cm-%C")}`,
    "-o",
    "ControlPersist=10m",
  ];
  if (opts?.passwordAuth) {
    args.push("-o", "PreferredAuthentications=password,keyboard-interactive,publickey");
  }
  if (ref.port) {
    args.push("-p", String(ref.port));
  }
  if (ref.identityFile) {
    args.push("-i", ref.identityFile);
  }
  return args;
}

export function buildSshArgv(
  ref: SshWorkspaceRef,
  remoteCommand: string,
  opts?: { tty?: boolean; controlDir?: string; connectTimeoutSec?: number; passwordAuth?: boolean },
): string[] {
  const args = sshClientFlags(ref, opts);
  args.push(opts?.tty ? "-t" : "-T");
  args.push(sshDestination(ref), "--", remoteCommand);
  return args;
}

export async function ensureSshControlDir(controlDir = defaultSshControlDir()): Promise<string> {
  await mkdir(controlDir, { recursive: true, mode: 0o700 });
  return controlDir;
}

export function sshExec(
  ref: SshWorkspaceRef,
  remoteCommand: string,
  options: OpenSshOptions & { timeoutMs?: number; tty?: boolean } = {},
): Promise<SshExecResult> {
  const spawnFn = options.spawnFn ?? spawn;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const controlDir = options.controlDir ?? defaultSshControlDir();
  const argv = buildSshArgv(ref, remoteCommand, {
    tty: options.tty,
    controlDir,
    connectTimeoutSec: options.connectTimeoutSec,
    passwordAuth: options.passwordAuth,
  });
  return new Promise((resolvePromise) => {
    const child = spawnFn("ssh", argv, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...options.extraEnv },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGKILL");
      resolvePromise({
        ok: false,
        code: null,
        stdout,
        stderr: stderr || `ssh timed out after ${timeoutMs}ms`,
      });
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
      resolvePromise({ ok: false, code: null, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolvePromise({ ok: code === 0, code, stdout, stderr });
    });
  });
}

export function spawnSsh(
  ref: SshWorkspaceRef,
  remoteCommand: string,
  options: OpenSshOptions & { tty?: boolean; stdio?: SpawnOptions["stdio"] } = {},
): ChildProcess {
  const spawnFn = options.spawnFn ?? spawn;
  const controlDir = options.controlDir ?? defaultSshControlDir();
  const argv = buildSshArgv(ref, remoteCommand, {
    tty: options.tty,
    controlDir,
    connectTimeoutSec: options.connectTimeoutSec,
    passwordAuth: options.passwordAuth,
  });
  return spawnFn("ssh", argv, {
    stdio: options.stdio ?? ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...options.extraEnv },
  });
}

export async function probeSshWorkspace(
  ref: SshWorkspaceRef,
  options: OpenSshOptions = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureSshControlDir(options.controlDir);
  const dirCheck = `test -d ${remotePathExpr(ref.remotePath)}`;
  const dirResult = await sshExec(ref, dirCheck, { ...options, timeoutMs: 15_000 });
  if (!dirResult.ok) {
    const detail = (dirResult.stderr || dirResult.stdout).trim() || `exit ${dirResult.code}`;
    return { ok: false, error: `Remote directory is not reachable (${ref.remotePath}): ${detail}` };
  }
  return { ok: true };
}

export async function sshGit(
  ref: SshWorkspaceRef,
  gitArgs: string[],
  options: OpenSshOptions = {},
): Promise<SshExecResult> {
  await ensureSshControlDir(options.controlDir);
  return sshExec(ref, remoteGitAt(ref.remotePath, gitArgs), options);
}

export function remoteAgentCommand(ref: SshWorkspaceRef, cursorExe: string, args: string[]): string {
  return remoteCdAndExec(ref.remotePath, [cursorExe, ...args]);
}
