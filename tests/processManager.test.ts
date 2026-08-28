import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessManager } from "../src/data/processManager.js";
import { closeProjectSqlite, openProjectSqlite } from "../src/data/projectDb.js";
import { shouldStopForMaxRuntime, shouldWarnStall } from "../src/cli/scriptGuide.js";

const openedRoots: string[] = [];

afterEach(() => {
  for (const root of openedRoots) {
    closeProjectSqlite(root);
  }
  openedRoots.length = 0;
});

function insertPersistedRunning(dir: string, pid: number, id: string): void {
  const db = openProjectSqlite(dir);
  const root = resolve(dir);
  db.exec(`
    CREATE TABLE IF NOT EXISTS managed_processes (
      id            TEXT PRIMARY KEY,
      project_root  TEXT NOT NULL,
      label         TEXT NOT NULL,
      command       TEXT NOT NULL,
      cwd           TEXT NOT NULL,
      pid           INTEGER,
      started_at    TEXT NOT NULL,
      ended_at      TEXT,
      status        TEXT NOT NULL,
      exit_code     INTEGER,
      stop_signal   TEXT,
      tags_json     TEXT NOT NULL,
      log_path      TEXT NOT NULL,
      last_output   TEXT NOT NULL DEFAULT ''
    );
  `);
  db.prepare(
    `INSERT INTO managed_processes (
      id, project_root, label, command, cwd, pid, started_at, ended_at, status, exit_code, stop_signal, tags_json, log_path, last_output
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    root,
    "persisted",
    "sleep 1",
    root,
    pid,
    new Date().toISOString(),
    null,
    "running",
    null,
    null,
    "[]",
    join(root, ".winnow", "logs", `${id}.log`),
    "",
  );
}

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
    openedRoots.push(dir);
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
    openedRoots.push(dir);
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

describe("ProcessManager init liveness and stopAll", () => {
  it("keeps a persisted running row when the pid is still alive", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winnow-proc-alive-"));
    openedRoots.push(dir);
    insertPersistedRunning(dir, process.pid, "alive-row");
    const manager = new ProcessManager(dir);
    await manager.init();
    const rec = manager.get("alive-row");
    expect(rec?.status).toBe("running");
    expect(rec?.pid).toBe(process.pid);
    const listed = manager.list().filter((row) => row.status === "running");
    expect(listed.some((row) => row.id === "alive-row")).toBe(true);
    manager.close();
  });

  it("marks a persisted running row error when the pid is dead", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winnow-proc-dead-"));
    openedRoots.push(dir);
    const spawned = spawnSync(process.execPath, ["-e", "process.exit(0)"], { encoding: "utf8" });
    const deadPid = spawned.pid;
    expect(typeof deadPid).toBe("number");
    if (typeof deadPid !== "number") {
      return;
    }
    expect(() => process.kill(deadPid, 0)).toThrow();
    insertPersistedRunning(dir, deadPid, "dead-row");
    const manager = new ProcessManager(dir);
    await manager.init();
    const rec = manager.get("dead-row");
    expect(rec?.status).not.toBe("running");
    expect(rec?.endedAt).toBeTruthy();
    manager.close();
  });

  it("stopAll stops every running live child", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winnow-proc-stopall-"));
    openedRoots.push(dir);
    const manager = new ProcessManager(dir);
    await manager.init();
    const started = await manager.startArgv({
      file: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    await manager.stopAll();
    expect(manager.get(started.process.id)?.status).not.toBe("running");
    manager.close();
  }, 15_000);
});
