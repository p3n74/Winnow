import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:os";

export type AskpassSession = {
  env: Record<string, string>;
  scriptPath: string;
  dispose: () => Promise<void>;
};

export function isSshAuthFailure(text: string): boolean {
  const t = String(text || "").toLowerCase();
  return (
    t.includes("permission denied") ||
    t.includes("authentication failed") ||
    t.includes("too many authentication") ||
    t.includes("no more authentication methods") ||
    t.includes("password:")
  );
}

/**
 * OpenSSH will not prompt a TTY when BatchMode is on. With a password we drop
 * BatchMode and feed ssh via SSH_ASKPASS instead of putting the secret on argv.
 */
export async function createAskpassSession(password: string, baseDir = tmpdir()): Promise<AskpassSession> {
  await mkdir(baseDir, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(join(baseDir, "winnow-askpass-"));
  const secretPath = join(dir, "secret");
  await writeFile(secretPath, password, { encoding: "utf8", mode: 0o600 });
  const isWin = platform() === "win32";
  const scriptPath = join(dir, isWin ? "askpass.cmd" : "askpass.sh");
  if (isWin) {
    await writeFile(scriptPath, `@echo off\r\ntype "${secretPath}"\r\n`, {
      encoding: "utf8",
      mode: 0o700,
    });
  } else {
    await writeFile(scriptPath, `#!/bin/sh\nexec cat ${JSON.stringify(secretPath)}\n`, {
      encoding: "utf8",
      mode: 0o700,
    });
  }
  const env: Record<string, string> = {
    SSH_ASKPASS: scriptPath,
    SSH_ASKPASS_REQUIRE: "force",
    DISPLAY: process.env.DISPLAY?.trim() || ":0",
  };
  return {
    env,
    scriptPath,
    dispose: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
