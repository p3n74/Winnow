import { describe, expect, it } from "vitest";
import { resolveExecutableOnPath, resolveSpawnCommand, spawnCommand } from "../src/cursor/spawnCommand.js";

describe("resolveSpawnCommand", () => {
  it.skipIf(process.platform !== "win32")("runs Windows cursor-agent via PowerShell, not a bare name", () => {
    const found = resolveExecutableOnPath("cursor-agent");
    expect(found).toMatch(/cursor-agent\.(cmd|ps1)$/i);
    const resolved = resolveSpawnCommand("cursor-agent");
    expect(resolved.command.toLowerCase()).toMatch(/powershell\.exe$/);
    expect(resolved.prefixArgs).toContain("-File");
    expect(resolved.prefixArgs.some((arg) => /cursor-agent\.ps1$/i.test(arg))).toBe(true);
    expect(resolved.shell).toBe(false);
  });

  it.skipIf(process.platform === "win32")("leaves unix commands unchanged", () => {
    const resolved = resolveSpawnCommand("cursor-agent");
    expect(resolved.command).toBe("cursor-agent");
    expect(resolved.prefixArgs).toEqual([]);
    expect(resolved.shell).toBe(false);
  });
});

describe("spawnCommand cursor-agent status", () => {
  it.skipIf(process.platform !== "win32" || !resolveExecutableOnPath("cursor-agent"))(
    "captures JSON status without ENOENT",
    async () => {
      const child = spawnCommand("cursor-agent", ["status", "--format", "json"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (buf: Buffer) => {
        stdout += buf.toString("utf8");
      });
      child.stderr?.on("data", (buf: Buffer) => {
        stderr += buf.toString("utf8");
      });
      const code = await new Promise<number>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (exit) => resolve(exit ?? 1));
      });
      expect(code).toBe(0);
      const parsed = JSON.parse(stdout.trim() || stderr.trim()) as { isAuthenticated?: boolean };
      expect(typeof parsed.isAuthenticated).toBe("boolean");
    },
  );
});
