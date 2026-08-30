import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";

export type ResolvedSpawn = {
  command: string;
  prefixArgs: string[];
  shell: boolean;
};

function windowsPowershell(): string {
  const root = process.env.SystemRoot || "C:\\Windows";
  return join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function pathDirs(): string[] {
  return (process.env.PATH || "").split(delimiter).filter(Boolean);
}

/** Resolve a PATHEXT-style command so Node can spawn Windows shims. */
export function resolveExecutableOnPath(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) {
    return null;
  }
  if (isAbsolute(trimmed) || trimmed.includes("/") || trimmed.includes("\\")) {
    return existsSync(trimmed) ? trimmed : null;
  }
  const dirs = pathDirs();
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    dirs.push(join(local, "cursor-agent"));
  }
  const exts =
    process.platform === "win32" ? [".cmd", ".exe", ".bat", ".ps1", ""] : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, trimmed + ext);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

export function resolveSpawnCommand(command: string): ResolvedSpawn {
  const resolved = resolveExecutableOnPath(command) || command;
  if (process.platform === "win32" && /\.ps1$/i.test(resolved)) {
    return {
      command: windowsPowershell(),
      prefixArgs: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolved],
      shell: false,
    };
  }
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(resolved)) {
    const siblingPs1 = resolved.replace(/\.(cmd|bat)$/i, ".ps1");
    if (existsSync(siblingPs1)) {
      return {
        command: windowsPowershell(),
        prefixArgs: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", siblingPs1],
        shell: false,
      };
    }
    return { command: resolved, prefixArgs: [], shell: true };
  }
  return {
    command: resolved,
    prefixArgs: [],
    shell: process.platform === "win32" && !/\.exe$/i.test(resolved),
  };
}

export function spawnCommand(command: string, args: string[], options: SpawnOptions = {}): ChildProcess {
  const resolved = resolveSpawnCommand(command);
  return spawn(resolved.command, [...resolved.prefixArgs, ...args], {
    ...options,
    shell: resolved.shell,
    windowsHide: options.windowsHide ?? true,
    env: options.env ?? process.env,
  });
}

export function commandDisplayName(command: string): string {
  const resolved = resolveExecutableOnPath(command);
  return resolved ? `${command} (${dirname(resolved)})` : command;
}
