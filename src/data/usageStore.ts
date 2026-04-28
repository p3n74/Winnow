import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { estimateCostUsd } from "./pricing.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id              TEXT PRIMARY KEY,
  project_path    TEXT NOT NULL,
  project_name    TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'cursor-agent',
  model           TEXT,
  model_pref      TEXT,
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  status          TEXT NOT NULL,
  exit_code       INTEGER,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL    NOT NULL DEFAULT 0,
  prompt_preview  TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);
CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_path);
CREATE INDEX IF NOT EXISTS idx_runs_model ON runs(model);
CREATE TABLE IF NOT EXISTS token_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id          TEXT NOT NULL,
  ts              TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);
`;

let _db: InstanceType<typeof Database> | undefined;
let _initError: string | undefined;

function dbPath(): string {
  return join(homedir(), ".winnow", "winnow.db");
}

export function openUsageDb(): InstanceType<typeof Database> | null {
  if (_initError) {
    return null;
  }
  if (_db) {
    return _db;
  }
  try {
    const path = dbPath();
    mkdirSync(dirname(path), { recursive: true });
    _db = new Database(path);
    _db.pragma("journal_mode = WAL");
    _db.exec(SCHEMA);
    return _db;
  } catch (err) {
    _initError = err instanceof Error ? err.message : String(err);
    return null;
  }
}

export function usageDbStatus(): { available: boolean; reason?: string } {
  const db = openUsageDb();
  if (db) {
    return { available: true };
  }
  return { available: false, reason: _initError ?? "unknown" };
}

export type UpsertRunStartInput = {
  id: string;
  projectPath: string;
  projectName: string;
  source?: string;
  modelPref?: string;
  startedAt: string;
  status: "running" | "done" | "error";
  promptPreview: string;
};

export function upsertRunStart(input: UpsertRunStartInput): void {
  const db = openUsageDb();
  if (!db) {
    return;
  }
  const source = input.source ?? "cursor-agent";
  const stmt = db.prepare(`
    INSERT INTO runs (
      id, project_path, project_name, source, model, model_pref,
      started_at, ended_at, status, exit_code,
      input_tokens, output_tokens, cost_usd, prompt_preview
    ) VALUES (
      @id, @project_path, @project_name, @source, NULL, @model_pref,
      @started_at, NULL, @status, NULL,
      0, 0, 0, @prompt_preview
    )
    ON CONFLICT(id) DO UPDATE SET
      project_path = excluded.project_path,
      project_name = excluded.project_name,
      source = excluded.source,
      model_pref = excluded.model_pref,
      status = excluded.status,
      started_at = excluded.started_at,
      prompt_preview = excluded.prompt_preview,
      ended_at = NULL,
      exit_code = NULL
  `);
  stmt.run({
    id: input.id,
    project_path: input.projectPath,
    project_name: input.projectName,
    source,
    model_pref: input.modelPref ?? null,
    started_at: input.startedAt,
    status: input.status,
    prompt_preview: input.promptPreview.slice(0, 500),
  });
}

export type RecordRunUsageInput = {
  inputTokens: number;
  outputTokens: number;
  model?: string | null;
};

export function recordRunUsage(runId: string, usage: RecordRunUsageInput): void {
  const db = openUsageDb();
  if (!db) {
    return;
  }
  const row = db
    .prepare("SELECT input_tokens, output_tokens, model, model_pref FROM runs WHERE id = ?")
    .get(runId) as { input_tokens: number; output_tokens: number; model: string | null; model_pref: string | null } | undefined;
  if (!row) {
    return;
  }
  const addIn = Math.max(0, Math.floor(Number(usage.inputTokens) || 0));
  const addOut = Math.max(0, Math.floor(Number(usage.outputTokens) || 0));
  const newIn = row.input_tokens + addIn;
  const newOut = row.output_tokens + addOut;

  // Don't overwrite with generic/auto/default model names if we have a meaningful model already
  const incomingModel = usage.model?.trim();
  const isGenericModel = !incomingModel ||
    incomingModel === "auto" ||
    incomingModel === "default" ||
    incomingModel === "composer";
  const existingMeaningfulModel = row.model &&
    row.model !== "auto" &&
    row.model !== "default" &&
    row.model !== "composer"
    ? row.model
    : row.model_pref;
  const model = isGenericModel && existingMeaningfulModel
    ? existingMeaningfulModel
    : (incomingModel || row.model);

  const cost = estimateCostUsd(model, newIn, newOut);
  db.prepare(
    `UPDATE runs SET input_tokens = ?, output_tokens = ?, model = COALESCE(?, model), cost_usd = ? WHERE id = ?`,
  ).run(newIn, newOut, model ?? null, cost, runId);
}

export function finalizeRun(
  runId: string,
  status: "running" | "done" | "error",
  exitCode: number | null,
  endedAt: string,
): void {
  const db = openUsageDb();
  if (!db) {
    return;
  }
  db.prepare(`UPDATE runs SET status = ?, exit_code = ?, ended_at = ? WHERE id = ?`).run(
    status,
    exitCode,
    endedAt,
    runId,
  );
}

function startOfLocalDay(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

export function querySummary(summaryRange: "today" | "7d" | "30d" | "all"):
  | {
      ok: true;
      lifetime: { inputTokens: number; outputTokens: number; costUsd: number; runs: number };
      /** Aggregates for the `summaryRange` query param (for chart context / highlighted window). */
      window: { inputTokens: number; outputTokens: number; costUsd: number; runs: number };
      today: { inputTokens: number; outputTokens: number; costUsd: number; runs: number };
      last7d: { inputTokens: number; outputTokens: number; costUsd: number; runs: number };
      last30d: { inputTokens: number; outputTokens: number; costUsd: number; runs: number };
      topProjects: { path: string; name: string; inputTokens: number; outputTokens: number; runs: number }[];
      topModels: { model: string; inputTokens: number; outputTokens: number; runs: number }[];
    }
  | { ok: false; reason: string } {
  const db = openUsageDb();
  if (!db) {
    return { ok: false, reason: _initError ?? "db_unavailable" };
  }
  const agg = (where: string | null, params: unknown[] = []) => {
    const sql = where
      ? `SELECT COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o, COALESCE(SUM(cost_usd),0) AS c, COUNT(*) AS n FROM runs WHERE ${where}`
      : `SELECT COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o, COALESCE(SUM(cost_usd),0) AS c, COUNT(*) AS n FROM runs`;
    return db.prepare(sql).get(...params) as { i: number; o: number; c: number; n: number };
  };
  const life = agg(null);
  const todayStart = startOfLocalDay();
  const today = agg("started_at >= ?", [todayStart]);
  const d7 = isoFromMs(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const last7d = agg("started_at >= ?", [d7]);
  const d30 = isoFromMs(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const last30d = agg("started_at >= ?", [d30]);
  let win = life;
  if (summaryRange === "today") {
    win = today;
  } else if (summaryRange === "7d") {
    win = last7d;
  } else if (summaryRange === "30d") {
    win = last30d;
  }

  const topProjects = db
    .prepare(
      `SELECT project_path AS path, project_name AS name,
        SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens, COUNT(*) AS runs
       FROM runs GROUP BY project_path ORDER BY (inputTokens + outputTokens) DESC LIMIT 8`,
    )
    .all() as { path: string; name: string; inputTokens: number; outputTokens: number; runs: number }[];

  const topModels = db
    .prepare(
      `SELECT COALESCE(model, '(unknown)') AS model,
        SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens, COUNT(*) AS runs
       FROM runs GROUP BY model ORDER BY (inputTokens + outputTokens) DESC LIMIT 8`,
    )
    .all() as { model: string; inputTokens: number; outputTokens: number; runs: number }[];

  return {
    ok: true as const,
    lifetime: { inputTokens: life.i, outputTokens: life.o, costUsd: life.c, runs: life.n },
    window: { inputTokens: win.i, outputTokens: win.o, costUsd: win.c, runs: win.n },
    today: { inputTokens: today.i, outputTokens: today.o, costUsd: today.c, runs: today.n },
    last7d: { inputTokens: last7d.i, outputTokens: last7d.o, costUsd: last7d.c, runs: last7d.n },
    last30d: { inputTokens: last30d.i, outputTokens: last30d.o, costUsd: last30d.c, runs: last30d.n },
    topProjects,
    topModels,
  };
}

export type TimeseriesRange = "24h" | "7d" | "30d" | "90d" | "all";
export type TimeseriesBucket = "hour" | "day" | "week";

export function queryTimeseries(opts: {
  range: TimeseriesRange;
  bucket: TimeseriesBucket;
  projectPath?: string;
  model?: string;
  source?: string;
}):
  | { ok: true; buckets: { ts: string; in: number; out: number; runs: number }[] }
  | { ok: false; reason: string } {
  const db = openUsageDb();
  if (!db) {
    return { ok: false, reason: _initError ?? "db_unavailable" };
  }
  const now = Date.now();
  const rangeMs: Record<TimeseriesRange, number | null> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
    all: null,
  };
  const fromMs = rangeMs[opts.range] === null ? 0 : now - (rangeMs[opts.range] as number);
  const fromIso = new Date(fromMs).toISOString();

  const clauses = ["started_at >= ?"];
  const params: unknown[] = [fromIso];
  if (opts.projectPath?.trim()) {
    clauses.push("project_path = ?");
    params.push(opts.projectPath.trim());
  }
  if (opts.model?.trim()) {
    clauses.push("COALESCE(model, '') = ?");
    params.push(opts.model.trim());
  }
  if (opts.source?.trim()) {
    clauses.push("source = ?");
    params.push(opts.source.trim());
  }
  const where = clauses.join(" AND ");
  const rows = db
    .prepare(
      `SELECT started_at AS startedAt, input_tokens AS inputTokens, output_tokens AS outputTokens FROM runs WHERE ${where} ORDER BY started_at ASC`,
    )
    .all(...params) as { startedAt: string; inputTokens: number; outputTokens: number }[];

  function bucketKey(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }
    if (opts.bucket === "hour") {
      d.setMinutes(0, 0, 0);
      return d.toISOString();
    }
    if (opts.bucket === "day") {
      d.setHours(0, 0, 0, 0);
      return d.toISOString();
    }
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - day.getDay());
    return day.toISOString();
  }

  const map = new Map<string, { in: number; out: number; runs: number }>();
  for (const r of rows) {
    const k = bucketKey(r.startedAt);
    const cur = map.get(k) ?? { in: 0, out: 0, runs: 0 };
    cur.in += r.inputTokens;
    cur.out += r.outputTokens;
    cur.runs += 1;
    map.set(k, cur);
  }
  const buckets = [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ts, v]) => ({ ts, ...v }));
  return { ok: true, buckets };
}

export type UsageRunRow = {
  id: string;
  projectPath: string;
  projectName: string;
  source: string;
  model: string | null;
  modelPref: string | null;
  startedAt: string;
  endedAt: string | null;
  status: string;
  exitCode: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  promptPreview: string | null;
};

export function queryRuns(opts: {
  limit: number;
  projectPath?: string;
  model?: string;
  source?: string;
  from?: string;
  to?: string;
}): { ok: true; runs: UsageRunRow[] } | { ok: false; reason: string } {
  const db = openUsageDb();
  if (!db) {
    return { ok: false, reason: _initError ?? "db_unavailable" };
  }
  const clauses: string[] = ["1=1"];
  const params: unknown[] = [];
  if (opts.projectPath?.trim()) {
    clauses.push("project_path = ?");
    params.push(opts.projectPath.trim());
  }
  if (opts.model?.trim()) {
    clauses.push("COALESCE(model, '') = ?");
    params.push(opts.model.trim());
  }
  if (opts.source?.trim()) {
    clauses.push("source = ?");
    params.push(opts.source.trim());
  }
  if (opts.from?.trim()) {
    clauses.push("started_at >= ?");
    params.push(opts.from.trim());
  }
  if (opts.to?.trim()) {
    clauses.push("started_at <= ?");
    params.push(opts.to.trim());
  }
  const where = clauses.join(" AND ");
  const lim = Math.min(200, Math.max(1, Math.floor(opts.limit)));
  const rows = db
    .prepare(
      `SELECT id, project_path AS projectPath, project_name AS projectName, source, model, model_pref AS modelPref,
        started_at AS startedAt, ended_at AS endedAt, status, exit_code AS exitCode,
        input_tokens AS inputTokens, output_tokens AS outputTokens, cost_usd AS costUsd, prompt_preview AS promptPreview
       FROM runs WHERE ${where} ORDER BY started_at DESC LIMIT ${lim}`,
    )
    .all(...params) as UsageRunRow[];
  return { ok: true, runs: rows };
}

export function queryFilters():
  | {
      ok: true;
      projects: { path: string; name: string }[];
      models: string[];
      sources: string[];
    }
  | { ok: false; reason: string } {
  const db = openUsageDb();
  if (!db) {
    return { ok: false, reason: _initError ?? "db_unavailable" };
  }
  const projects = db
    .prepare(
      `SELECT DISTINCT project_path AS path, project_name AS name FROM runs ORDER BY project_name ASC LIMIT 200`,
    )
    .all() as { path: string; name: string }[];
  const models = (
    db.prepare(`SELECT DISTINCT model FROM runs WHERE model IS NOT NULL AND TRIM(model) != '' ORDER BY model ASC LIMIT 100`).all() as {
      model: string;
    }[]
  ).map((r) => r.model);
  const sources = (
    db.prepare(`SELECT DISTINCT source FROM runs ORDER BY source ASC`).all() as { source: string }[]
  ).map((r) => r.source);
  return { ok: true, projects, models, sources };
}

export type LastAgentRunRow = UsageRunRow & {
  durationMs: number | null;
};

/**
 * Most recent finished or in-flight Cursor agent run (usage DB), by activity time.
 */
export function queryLastAgentRun():
  | { ok: true; run: LastAgentRunRow | null }
  | { ok: false; reason: string } {
  const db = openUsageDb();
  if (!db) {
    return { ok: false, reason: _initError ?? "db_unavailable" };
  }
  const row = db
    .prepare(
      `SELECT id, project_path AS projectPath, project_name AS projectName, source, model, model_pref AS modelPref,
        started_at AS startedAt, ended_at AS endedAt, status, exit_code AS exitCode,
        input_tokens AS inputTokens, output_tokens AS outputTokens, cost_usd AS costUsd, prompt_preview AS promptPreview
       FROM runs WHERE source = 'cursor-agent'
       ORDER BY COALESCE(ended_at, started_at) DESC LIMIT 1`,
    )
    .get() as UsageRunRow | undefined;
  if (!row) {
    return { ok: true, run: null };
  }
  const start = Date.parse(row.startedAt);
  const end = row.endedAt ? Date.parse(row.endedAt) : null;
  let durationMs: number | null = null;
  if (Number.isFinite(start) && end !== null && Number.isFinite(end)) {
    durationMs = Math.max(0, end - start);
  }
  return { ok: true, run: { ...row, durationMs } };
}
