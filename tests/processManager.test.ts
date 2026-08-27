import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProcessManager } from "../src/data/processManager.js";
import { shouldStopForMaxRuntime, shouldWarnStall } from "../src/cli/scriptGuide.js";

describe("stall helpers", () => {
  it("warns after the stall window", () => {
    expect(shouldWarnStall(0, 45_000, 45_000)).toBe(true);
    expect(shouldWarnStall(0, 10_000, 45_000)).toBe(false);
    expect(shouldStopForMaxRuntime(0, 2 * 3600_000, 2 * 3600_000)).toBe(true);
  });
});

describe("ProcessManager argv spawn safeties", () => {
  it("exits on stdin EOF instead of hanging", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winnow-proc-stdin-"));
    const manager = new ProcessManager(dir);
    await manager.init();
    const started = await manager.startArgv({
      file: process.execPath,
      args: [
        "-e",
        "process.stdin.resume(); process.stdin.on('end', () => process.exit(42)); setTimeout(() => process.exit(7), 8000)",
      ],
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    for (let i = 0; i < 80; i += 1) {
      const rec = manager.get(started.process.id);
      if (rec && rec.status !== "running") {
        expect(rec.exitCode).toBe(42);
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("stdin-ignored child did not exit");
  }, 10_000);

  it("sends SIGINT before SIGKILL", async () => {
    if (process.platform === "win32") {
      return;
    }
    const dir = await mkdtemp(join(tmpdir(), "winnow-proc-int-"));
    const manager = new ProcessManager(dir);
    await manager.init();
    const started = await manager.startArgv({
      file: process.execPath,
      args: ["-e", "process.on('SIGINT', () => process.exit(0)); setInterval(() => {}, 1000)"],
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const steps: string[] = [];
    const result = await manager.stopLadder(started.process.id, {
      graceMs: 800,
      onStep: (signal) => {
        steps.push(signal);
      },
    });
    expect(result.ok).toBe(true);
    expect(steps[0]).toBe("SIGINT");
    expect(steps.includes("SIGKILL")).toBe(false);
  }, 10_000);
});
