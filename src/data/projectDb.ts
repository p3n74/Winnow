import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const cache = new Map<string, InstanceType<typeof Database>>();

export function projectSqlitePath(projectRoot: string): string {
  return join(resolve(projectRoot), ".winnow", "winnow.db");
}

export function openProjectSqlite(projectRoot: string): InstanceType<typeof Database> {
  const path = projectSqlitePath(projectRoot);
  const existing = cache.get(path);
  if (existing) {
    return existing;
  }
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  // busy_timeout is connection-scoped and takes no locks; set it before WAL
  // so SQLITE_BUSY during journal_mode / -shm setup waits instead of failing instantly.
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  cache.set(path, db);
  return db;
}

export function closeProjectSqlite(projectRoot: string): void {
  const path = projectSqlitePath(projectRoot);
  const db = cache.get(path);
  if (!db) {
    return;
  }
  cache.delete(path);
  try {
    db.close();
  } catch {
    // already closed
  }
}
