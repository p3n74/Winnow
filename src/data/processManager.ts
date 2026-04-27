import { spawn, type ChildProcess } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { platform } from "node:os";
import Database from "better-sqlite3";

export type ManagedProcessStatus = "running" | "done" | "error" | "stopped";

export type ManagedProcessRecord = {
  id: string;
  projectRoot: string;
  label: string;
  command: string;
  cwd: string;
  pid: number | null;
  startedAt: string;
  endedAt?: string;
  status: ManagedProcessStatus;
  exitCode?: number | null;
  stopSignal?: NodeJS.Signals;
  tags: string[];
  logPath: string;
  lastOutput: string;
};

export type ManagedProcessStartInput = {
  command: string;
  label?: string;
  cwd?: string;
  tags?: string[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeTailLine(chunk: string): string {
  const lines = chunk
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

function normalizeTags(input: string[] | undefined): string[] {
  const set = new Set<string>();
  for (const raw of input ?? []) {
    const t = String(raw || "").trim().toLowerCase();
    if (t) set.add(t);
  }
  return [...set].slice(0, 8);
}

export class ProcessManager {
  private readonly projectRoot: string;
  private readonly dbPath: string;
  private readonly logsDir: string;
  private readonly records = new Map<string, ManagedProcessRecord>();
  private readonly liveChildren = new Map<string, ChildProcess>();
  private db: InstanceType<typeof Database> | null = null;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
    const processRoot = join(this.projectRoot, ".winnow");
    this.dbPath = join(processRoot, "winnow.db");
    this.logsDir = join(processRoot, "logs");
  }

  async init(): Promise<void> {
    await mkdir(this.logsDir, { recursive: true });
    if (!this.db) {
      this.db = new Database(this.dbPath);
      this.db.exec(`
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
        CREATE INDEX IF NOT EXISTS idx_managed_processes_started ON managed_processes(started_at);
      `);
    }
    const rows = this.db
      .prepare(
        `SELECT id, project_root AS projectRoot, label, command, cwd, pid, started_at AS startedAt, ended_at AS endedAt,
                status, exit_code AS exitCode, stop_signal AS stopSignal, tags_json AS tagsJson, log_path AS logPath, last_output AS lastOutput
         FROM managed_processes WHERE project_root = ? ORDER BY started_at DESC`,
      )
      .all(this.projectRoot) as Array<{
      id: string;
      projectRoot: string;
      label: string;
      command: string;
      cwd: string;
      pid: number | null;
      startedAt: string;
      endedAt?: string;
      status: ManagedProcessStatus;
      exitCode?: number | null;
      stopSignal?: NodeJS.Signals;
      tagsJson: string;
      logPath: string;
      lastOutput: string;
    }>;
    for (const row of rows) {
      const normalized: ManagedProcessRecord = {
        ...row,
        projectRoot: this.projectRoot,
        pid: typeof row.pid === "number" ? row.pid : null,
        status: row.status === "running" ? "error" : row.status,
        endedAt: row.status === "running" ? nowIso() : row.endedAt,
        tags: (() => {
          try {
            const parsed = JSON.parse(row.tagsJson);
            return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
          } catch {
            return [];
          }
        })(),
        lastOutput: row.lastOutput ?? "",
      };
      if (row.status === "running") {
        normalized.exitCode = row.exitCode ?? null;
      }
      this.records.set(normalized.id, normalized);
    }
    this.persist();
  }

  list(): ManagedProcessRecord[] {
    return [...this.records.values()].sort((a, b) => {
      return (b.startedAt || "").localeCompare(a.startedAt || "");
    });
  }

  get(id: string): ManagedProcessRecord | null {
    return this.records.get(id) ?? null;
  }

  private async appendLog(record: ManagedProcessRecord, chunk: string): Promise<void> {
    if (!chunk) {
      return;
    }
    record.lastOutput = safeTailLine(chunk) || record.lastOutput;
    await appendFile(record.logPath, chunk, "utf8").catch(() => {});
    this.persistOne(record);
  }

  private persistOne(record: ManagedProcessRecord): void {
    if (!this.db) return;
    this.db
      .prepare(
        `INSERT INTO managed_processes (
          id, project_root, label, command, cwd, pid, started_at, ended_at, status, exit_code, stop_signal, tags_json, log_path, last_output
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project_root = excluded.project_root,
          label = excluded.label,
          command = excluded.command,
          cwd = excluded.cwd,
          pid = excluded.pid,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at,
          status = excluded.status,
          exit_code = excluded.exit_code,
          stop_signal = excluded.stop_signal,
          tags_json = excluded.tags_json,
          log_path = excluded.log_path,
          last_output = excluded.last_output`,
      )
      .run(
        record.id,
        record.projectRoot,
        record.label,
        record.command,
        record.cwd,
        record.pid,
        record.startedAt,
        record.endedAt ?? null,
        record.status,
        record.exitCode ?? null,
        record.stopSignal ?? null,
        JSON.stringify(record.tags ?? []),
        record.logPath,
        record.lastOutput ?? "",
      );
  }

  private persist(): void {
    for (const row of this.records.values()) {
      this.persistOne(row);
    }
  }

  async start(input: ManagedProcessStartInput): Promise<{ ok: true; process: ManagedProcessRecord } | { ok: false; error: string }> {
    const command = String(input.command || "").trim();
    if (!command) {
      return { ok: false, error: "command is required" };
    }
    const cwd = resolve(this.projectRoot, String(input.cwd || "."));
    const id = randomId();
    const label = String(input.label || "").trim() || basename(command.split(/\s+/)[0] || command);
    const logPath = join(this.logsDir, `${id}.log`);
    const startedAt = nowIso();
    const isWin = platform() === "win32";
    const child = isWin
      ? spawn("cmd", ["/d", "/s", "/c", command], {
          cwd,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
          windowsHide: true,
        })
      : spawn("/bin/zsh", ["-lc", command], {
          cwd,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
        });

    const record: ManagedProcessRecord = {
      id,
      projectRoot: this.projectRoot,
      label,
      command,
      cwd,
      pid: child.pid ?? null,
      startedAt,
      status: "running",
      tags: normalizeTags(input.tags),
      logPath,
      lastOutput: "",
    };
    this.records.set(id, record);
    this.liveChildren.set(id, child);
    this.persistOne(record);

    child.stdout?.on("data", (buf: Buffer) => {
      void this.appendLog(record, buf.toString("utf8"));
    });
    child.stderr?.on("data", (buf: Buffer) => {
      void this.appendLog(record, buf.toString("utf8"));
    });
    child.on("error", (error) => {
      record.status = "error";
      record.endedAt = nowIso();
      record.exitCode = 1;
      void this.appendLog(record, `\n[spawn error] ${error.message}\n`);
      this.liveChildren.delete(id);
      this.persistOne(record);
    });
    child.on("close", (code, signal) => {
      if (record.status === "running") {
        record.status = code === 0 ? "done" : "error";
      }
      record.endedAt = nowIso();
      record.exitCode = typeof code === "number" ? code : null;
      record.stopSignal = signal ?? undefined;
      this.liveChildren.delete(id);
      this.persistOne(record);
    });

    return { ok: true, process: record };
  }

  stop(id: string): { ok: true; stopped: boolean; message?: string } | { ok: false; error: string } {
    const record = this.records.get(id);
    if (!record) {
      return { ok: false, error: "process not found" };
    }
    if (record.status !== "running") {
      return { ok: true, stopped: false, message: "process not running" };
    }
    const child = this.liveChildren.get(id);
    const pid = child?.pid ?? record.pid;
    if (!pid) {
      record.status = "stopped";
      record.endedAt = nowIso();
      this.persistOne(record);
      return { ok: true, stopped: false, message: "missing process pid" };
    }
    try {
      if (platform() === "win32") {
        process.kill(pid, "SIGTERM");
      } else {
        // Kill process group for commands that spawn watchers/servers.
        process.kill(-pid, "SIGTERM");
      }
      record.status = "stopped";
      record.endedAt = nowIso();
      record.stopSignal = "SIGTERM";
      this.persistOne(record);
      return { ok: true, stopped: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async readLog(id: string, tailLines: number): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
    const record = this.records.get(id);
    if (!record) {
      return { ok: false, error: "process not found" };
    }
    try {
      const raw = await readFile(record.logPath, "utf8");
      const lines = raw.split(/\r?\n/);
      const take = Math.min(2000, Math.max(20, Math.floor(tailLines || 200)));
      return { ok: true, content: lines.slice(-take).join("\n") };
    } catch {
      return { ok: true, content: "" };
    }
  }
}
