import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import pty from "node-pty";

function resolveShell() {
  if (process.platform === "win32") {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const candidates = [
      join(programFiles, "Git", "bin", "bash.exe"),
      join(programFilesX86, "Git", "bin", "bash.exe"),
    ];
    for (const candidate of candidates) {
      try {
        accessSync(candidate, constants.F_OK);
        return candidate;
      } catch {
        // try next
      }
    }
    throw new Error(
      "Git Bash not found. Install Git for Windows (winget install Git.Git) so terminal panes can spawn a shell.",
    );
  }

  const shellCandidates = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].filter(
    (value) => Boolean(value && value.trim()),
  );
  for (const candidate of shellCandidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error("No executable POSIX shell found for PTY");
}

const shell = resolveShell();
const child = pty.spawn(shell, ["-c", "exit"], {
  name: "xterm-256color",
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: process.env,
});
child.onExit((e) => {
  process.exit(e.exitCode === 0 ? 0 : 1);
});
