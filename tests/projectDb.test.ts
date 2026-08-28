import Database from "better-sqlite3";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PlanStore } from "../src/data/planStore.js";
import { ProcessManager } from "../src/data/processManager.js";
import { closeProjectSqlite, openProjectSqlite, projectSqlitePath } from "../src/data/projectDb.js";

const openedRoots: string[] = [];

function isSqliteBusy(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "SQLITE_BUSY" || /database is locked/i.test(message);
}

afterEach(() => {
  for (const root of openedRoots) {
    closeProjectSqlite(root);
  }
  openedRoots.length = 0;
});

describe("project SQLite cache", () => {
  it("returns the same Database handle for repeat openProjectSqlite calls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winnow-pdb-same-"));
    openedRoots.push(dir);
    const a = openProjectSqlite(dir);
    const b = openProjectSqlite(dir);
    expect(a).toBe(b);
    closeProjectSqlite(dir);
    const c = openProjectSqlite(dir);
    expect(c).not.toBe(a);
  });

  it("sets journal_mode wal and busy_timeout 5000", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winnow-pdb-pragma-"));
    openedRoots.push(dir);
    const db = openProjectSqlite(dir);
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
  });

  it("second writer with busy_timeout 0 throws SQLITE_BUSY while a transaction is held", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winnow-pdb-lock-"));
    openedRoots.push(dir);
    const a = openProjectSqlite(dir);
    const path = projectSqlitePath(dir);
    a.exec("CREATE TABLE IF NOT EXISTS lock_probe (id INTEGER PRIMARY KEY, v TEXT)");
    a.exec("BEGIN IMMEDIATE");
    a.prepare("INSERT INTO lock_probe (v) VALUES (?)").run("held");

    const b = new Database(path, { timeout: 0 });
    try {
      b.pragma("busy_timeout = 0");
      try {
        b.pragma("journal_mode = WAL");
      } catch (error) {
        expect(isSqliteBusy(error)).toBe(true);
        return;
      }
      let writeError: unknown;
      try {
        b.prepare("INSERT INTO lock_probe (v) VALUES (?)").run("contended");
      } catch (error) {
        writeError = error;
      }
      expect(writeError).toBeTruthy();
      expect(isSqliteBusy(writeError)).toBe(true);
    } finally {
      b.close();
      try {
        a.exec("ROLLBACK");
      } catch {
        // transaction already closed
      }
    }
  });

  it("lets PlanStore and ProcessManager share one file with coexisting tables", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winnow-pdb-coexist-"));
    openedRoots.push(dir);
    const plans = new PlanStore(dir);
    plans.init();
    const created = plans.create({ title: "Shared sqlite plan" });

    const manager = new ProcessManager(dir);
    await manager.init();
    const started = await manager.startArgv({
      file: process.execPath,
      args: ["-e", "process.exit(0)"],
    });
    expect(started.ok).toBe(true);
    if (started.ok) {
      await manager.stopAll();
    }
    manager.close();

    expect(plans.get(created.id)?.title).toBe("Shared sqlite plan");
    const db = openProjectSqlite(dir);
    const names = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(names).toEqual(expect.arrayContaining(["plans", "managed_processes"]));
  });
});
