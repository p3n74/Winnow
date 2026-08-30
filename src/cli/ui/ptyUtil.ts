import { spawnSync } from "node:child_process";

export function quoteExecutableForBash(executable: string): string {
  const posix = executable.replace(/\\/g, "/");
  return `'${posix.replace(/'/g, `'\\''`)}'`;
}

export function firstPaneCommandToken(command: string): string {
  return command.trim().split(/\s+/)[0] ?? "";
}

/** Whether Git Bash (or another bash) can resolve the pane command on PATH. */
export function bashHasCommand(bashPath: string, commandLine: string): boolean {
  const token = firstPaneCommandToken(commandLine);
  if (!token || /[;&|`$<>]/.test(token)) {
    return false;
  }
  const result = spawnSync(bashPath, ["-c", `command -v ${quoteExecutableForBash(token)} >/dev/null 2>&1`], {
    windowsHide: true,
    timeout: 5000,
    encoding: "utf8",
  });
  return result.status === 0;
}

export function paneLaunchScript(bashPath: string, commandLine: string, quotedShell: string): string {
  const raw = commandLine.trim();
  if (raw && bashHasCommand(bashPath, raw)) {
    return `${raw}; exec ${quotedShell}`;
  }
  return `exec ${quotedShell}`;
}

export function isDeadPtyResizeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cannot resize a pty that has already exited/i.test(message);
}

export function safePtyResize(
  ptyProcess: { resize(cols: number, rows: number): void },
  cols: number,
  rows: number,
): void {
  try {
    ptyProcess.resize(Math.max(20, cols), Math.max(6, rows));
  } catch (error) {
    if (!isDeadPtyResizeError(error)) {
      throw error;
    }
  }
}

export function safePtyWrite(ptyProcess: { write(data: string): void }, data: string): void {
  try {
    ptyProcess.write(data);
  } catch {
    // PTY already exited
  }
}

let deadPtyResizeGuardInstalled = false;

/** node-pty can throw this from a deferred Windows resize after the PTY has exited. */
export function installDeadPtyResizeGuard(): void {
  if (process.platform !== "win32" || deadPtyResizeGuardInstalled) {
    return;
  }
  deadPtyResizeGuardInstalled = true;
  process.on("uncaughtException", (error) => {
    if (isDeadPtyResizeError(error)) {
      process.stderr.write("[winnow-ui] ignored dead PTY resize\n");
      return;
    }
    process.stderr.write(
      `[winnow-ui] uncaughtException: ${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
