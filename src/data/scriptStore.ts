import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LinkedScriptConfig, ScriptKnob, ScriptScanEntry } from "../cli/scriptIndex.js";

export type ScriptCatalogRecord = {
  id: string;
  relPath: string;
  title: string;
  blurb: string;
  knobs: ScriptKnob[];
  userEditedKnobIds: string[];
  pinned: boolean;
  ignored: boolean;
  lastArgv: string[];
  lastEnv: Record<string, string>;
  stallMs: number | null;
  maxRuntimeMs: number | null;
  autoStopOnStall: boolean;
  lastRunAt: string | null;
  updatedAt: string;
  sampleCommand: string;
  linkedConfigs: LinkedScriptConfig[];
};

export type ScriptRunStatus = "proposed" | "running" | "done" | "error" | "stopped" | "stalled";

export type ScriptRunRecord = {
  id: string;
  scriptId: string;
  intent: string;
  knobsJson: string;
  proposedArgv: string[];
  actualArgv: string[];
  env: Record<string, string>;
  cwd: string;
  status: ScriptRunStatus;
  exitCode: number | null;
  stalled: boolean;
  processId: string | null;
  agentSessionId: string | null;
  logPath: string | null;
  summaryMd: string;
  startedAt: string;
  endedAt: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseJsonArray(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string | null | undefined): Record<string, string> {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      out[key] = String(value ?? "");
    }
    return out;
  } catch {
    return {};
  }
}

function parseLinkedConfigs(raw: string | null | undefined): LinkedScriptConfig[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? (parsed as LinkedScriptConfig[]) : [];
  } catch {
    return [];
  }
}

function parseKnobs(raw: string | null | undefined): ScriptKnob[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? (parsed as ScriptKnob[]) : [];
  } catch {
    return [];
  }
}

export class ScriptStore {
  private readonly projectRoot: string;
  private readonly dbPath: string;
  private db: InstanceType<typeof Database> | null = null;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
    const root = join(this.projectRoot, ".winnow");
    mkdirSync(join(root, "scripts"), { recursive: true });
    this.dbPath = join(root, "winnow.db");
  }

  init(): void {
    if (this.db) {
      return;
    }
    this.db = new Database(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS script_catalog (
        id TEXT PRIMARY KEY,
        rel_path TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        blurb TEXT NOT NULL DEFAULT '',
        knobs_json TEXT NOT NULL DEFAULT '[]',
        user_edited_knob_ids TEXT NOT NULL DEFAULT '[]',
        pinned INTEGER NOT NULL DEFAULT 0,
        ignored INTEGER NOT NULL DEFAULT 0,
        last_argv_json TEXT NOT NULL DEFAULT '[]',
        last_env_json TEXT NOT NULL DEFAULT '{}',
        stall_ms INTEGER,
        max_runtime_ms INTEGER,
        auto_stop_on_stall INTEGER NOT NULL DEFAULT 0,
        last_run_at TEXT,
        updated_at TEXT NOT NULL,
        sample_command TEXT NOT NULL DEFAULT '',
        linked_configs_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS script_runs (
        id TEXT PRIMARY KEY,
        script_id TEXT NOT NULL,
        intent TEXT NOT NULL DEFAULT '',
        knobs_json TEXT NOT NULL DEFAULT '[]',
        proposed_argv_json TEXT NOT NULL DEFAULT '[]',
        actual_argv_json TEXT NOT NULL DEFAULT '[]',
        env_json TEXT NOT NULL DEFAULT '{}',
        cwd TEXT NOT NULL DEFAULT '.',
        status TEXT NOT NULL,
        exit_code INTEGER,
        stalled INTEGER NOT NULL DEFAULT 0,
        process_id TEXT,
        agent_session_id TEXT,
        log_path TEXT,
        summary_md TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        ended_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_script_runs_script ON script_runs(script_id, started_at DESC);
    `);
    const addColumn = (sql: string): void => {
      try {
        this.db?.exec(sql);
      } catch {
        // already exists
      }
    };
    addColumn(`ALTER TABLE script_catalog ADD COLUMN sample_command TEXT NOT NULL DEFAULT ''`);
    addColumn(`ALTER TABLE script_catalog ADD COLUMN linked_configs_json TEXT NOT NULL DEFAULT '[]'`);
  }

  private requireDb(): InstanceType<typeof Database> {
    if (!this.db) {
      throw new Error("script store not initialized");
    }
    return this.db;
  }

  private rowToCatalog(row: Record<string, unknown>): ScriptCatalogRecord {
    return {
      id: String(row.id),
      relPath: String(row.relPath),
      title: String(row.title),
      blurb: String(row.blurb || ""),
      knobs: parseKnobs(String(row.knobsJson || "[]")),
      userEditedKnobIds: parseJsonArray(String(row.userEditedKnobIds || "[]")),
      pinned: Boolean(row.pinned),
      ignored: Boolean(row.ignored),
      lastArgv: parseJsonArray(String(row.lastArgvJson || "[]")),
      lastEnv: parseJsonObject(String(row.lastEnvJson || "{}")),
      stallMs: typeof row.stallMs === "number" ? row.stallMs : row.stallMs == null ? null : Number(row.stallMs),
      maxRuntimeMs:
        typeof row.maxRuntimeMs === "number" ? row.maxRuntimeMs : row.maxRuntimeMs == null ? null : Number(row.maxRuntimeMs),
      autoStopOnStall: Boolean(row.autoStopOnStall),
      lastRunAt: row.lastRunAt ? String(row.lastRunAt) : null,
      updatedAt: String(row.updatedAt),
      sampleCommand: String(row.sampleCommand || ""),
      linkedConfigs: parseLinkedConfigs(String(row.linkedConfigsJson || "[]")),
    };
  }

  upsertFromScan(entries: ScriptScanEntry[]): ScriptCatalogRecord[] {
    const db = this.requireDb();
    const updatedAt = nowIso();
    const insert = db.prepare(
      `INSERT INTO script_catalog (
        id, rel_path, title, blurb, knobs_json, user_edited_knob_ids, pinned, ignored,
        last_argv_json, last_env_json, stall_ms, max_runtime_ms, auto_stop_on_stall, last_run_at, updated_at,
        sample_command, linked_configs_json
      ) VALUES (?, ?, ?, ?, ?, '[]', 0, 0, '[]', '{}', NULL, NULL, 0, NULL, ?, ?, ?)`,
    );
    const update = db.prepare(
      `UPDATE script_catalog SET
        title = CASE WHEN title = rel_path THEN ? ELSE title END,
        blurb = CASE WHEN blurb = '' THEN ? ELSE blurb END,
        knobs_json = ?,
        sample_command = ?,
        linked_configs_json = ?,
        updated_at = ?
       WHERE rel_path = ?`,
    );
    const tx = db.transaction(() => {
      for (const entry of entries) {
        const id = entry.relPath;
        const title = entry.relPath.split("/").pop() || entry.relPath;
        const sampleCommand = entry.sampleCommand || "";
        const linkedJson = JSON.stringify(entry.linkedConfigs || []);
        const cur = this.get(id);
        if (!cur) {
          insert.run(
            id,
            entry.relPath,
            title,
            entry.blurb || "",
            JSON.stringify(entry.knobs || []),
            updatedAt,
            sampleCommand,
            linkedJson,
          );
          continue;
        }
        const merged = mergeCatalogKnobs(cur.knobs, entry.knobs || [], cur.userEditedKnobIds);
        update.run(title, entry.blurb || "", JSON.stringify(merged), sampleCommand, linkedJson, updatedAt, entry.relPath);
      }
    });
    tx();
    return this.list({ includeIgnored: false });
  }

  list(opts?: { includeIgnored?: boolean }): ScriptCatalogRecord[] {
    const db = this.requireDb();
    const rows = db
      .prepare(
        `SELECT id, rel_path AS relPath, title, blurb, knobs_json AS knobsJson,
                user_edited_knob_ids AS userEditedKnobIds, pinned, ignored,
                last_argv_json AS lastArgvJson, last_env_json AS lastEnvJson,
                stall_ms AS stallMs, max_runtime_ms AS maxRuntimeMs,
                auto_stop_on_stall AS autoStopOnStall, last_run_at AS lastRunAt, updated_at AS updatedAt,
                sample_command AS sampleCommand, linked_configs_json AS linkedConfigsJson
         FROM script_catalog
         ${opts?.includeIgnored ? "" : "WHERE ignored = 0"}
         ORDER BY pinned DESC, last_run_at IS NULL, last_run_at DESC, rel_path ASC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToCatalog(row));
  }

  get(id: string): ScriptCatalogRecord | null {
    const db = this.requireDb();
    const row = db
      .prepare(
        `SELECT id, rel_path AS relPath, title, blurb, knobs_json AS knobsJson,
                user_edited_knob_ids AS userEditedKnobIds, pinned, ignored,
                last_argv_json AS lastArgvJson, last_env_json AS lastEnvJson,
                stall_ms AS stallMs, max_runtime_ms AS maxRuntimeMs,
                auto_stop_on_stall AS autoStopOnStall, last_run_at AS lastRunAt, updated_at AS updatedAt,
                sample_command AS sampleCommand, linked_configs_json AS linkedConfigsJson
         FROM script_catalog WHERE id = ? OR rel_path = ?`,
      )
      .get(id, id) as Record<string, unknown> | undefined;
    return row ? this.rowToCatalog(row) : null;
  }

  setFlags(id: string, patch: { pinned?: boolean; ignored?: boolean }): ScriptCatalogRecord {
    const cur = this.get(id);
    if (!cur) {
      throw new Error("script not found");
    }
    const db = this.requireDb();
    db.prepare(`UPDATE script_catalog SET pinned = ?, ignored = ?, updated_at = ? WHERE id = ?`).run(
      patch.pinned ?? cur.pinned ? 1 : 0,
      (patch.ignored ?? cur.ignored) ? 1 : 0,
      nowIso(),
      cur.id,
    );
    const next = this.get(cur.id);
    if (!next) {
      throw new Error("script not found");
    }
    return next;
  }

  saveKnobs(id: string, knobs: ScriptKnob[], userEdited = false): ScriptCatalogRecord {
    const cur = this.get(id);
    if (!cur) {
      throw new Error("script not found");
    }
    const edited = userEdited
      ? [...new Set([...cur.userEditedKnobIds, ...knobs.map((k) => k.id)])]
      : cur.userEditedKnobIds;
    const db = this.requireDb();
    db.prepare(`UPDATE script_catalog SET knobs_json = ?, user_edited_knob_ids = ?, updated_at = ? WHERE id = ?`).run(
      JSON.stringify(knobs),
      JSON.stringify(edited),
      nowIso(),
      cur.id,
    );
    const next = this.get(cur.id);
    if (!next) {
      throw new Error("script not found");
    }
    return next;
  }

  rememberRecipe(id: string, argv: string[], env: Record<string, string>): void {
    const cur = this.get(id);
    if (!cur) {
      return;
    }
    const knobs = cur.knobs.map((knob) => {
      const idx = argv.indexOf(knob.flag);
      if (idx >= 0 && argv[idx + 1] && !String(argv[idx + 1]).startsWith("-")) {
        return { ...knob, lastValue: argv[idx + 1] };
      }
      if (idx >= 0 && (knob.kind === "bool" || argv[idx + 1] === undefined || String(argv[idx + 1]).startsWith("-"))) {
        return { ...knob, lastValue: "true" };
      }
      return knob;
    });
    this.requireDb()
      .prepare(
        `UPDATE script_catalog SET last_argv_json = ?, last_env_json = ?, knobs_json = ?, last_run_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(argv), JSON.stringify(env), JSON.stringify(knobs), nowIso(), nowIso(), cur.id);
  }

  createRun(input: {
    scriptId: string;
    intent: string;
    knobs: ScriptKnob[];
    proposedArgv: string[];
    actualArgv: string[];
    env: Record<string, string>;
    cwd: string;
    agentSessionId?: string;
  }): ScriptRunRecord {
    const id = randomId();
    const startedAt = nowIso();
    this.requireDb()
      .prepare(
        `INSERT INTO script_runs (
          id, script_id, intent, knobs_json, proposed_argv_json, actual_argv_json, env_json, cwd,
          status, exit_code, stalled, process_id, agent_session_id, log_path, summary_md, started_at, ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', NULL, 0, NULL, ?, NULL, '', ?, NULL)`,
      )
      .run(
        id,
        input.scriptId,
        input.intent,
        JSON.stringify(input.knobs),
        JSON.stringify(input.proposedArgv),
        JSON.stringify(input.actualArgv),
        JSON.stringify(input.env),
        input.cwd,
        input.agentSessionId ?? null,
        startedAt,
      );
    const created = this.getRun(id);
    if (!created) {
      throw new Error("failed to create run");
    }
    return created;
  }

  getRun(id: string): ScriptRunRecord | null {
    const row = this.requireDb()
      .prepare(
        `SELECT id, script_id AS scriptId, intent, knobs_json AS knobsJson, proposed_argv_json AS proposedArgvJson,
                actual_argv_json AS actualArgvJson, env_json AS envJson, cwd, status, exit_code AS exitCode,
                stalled, process_id AS processId, agent_session_id AS agentSessionId, log_path AS logPath,
                summary_md AS summaryMd, started_at AS startedAt, ended_at AS endedAt
         FROM script_runs WHERE id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToRun(row) : null;
  }

  listRuns(scriptId: string, limit = 8): ScriptRunRecord[] {
    const rows = this.requireDb()
      .prepare(
        `SELECT id, script_id AS scriptId, intent, knobs_json AS knobsJson, proposed_argv_json AS proposedArgvJson,
                actual_argv_json AS actualArgvJson, env_json AS envJson, cwd, status, exit_code AS exitCode,
                stalled, process_id AS processId, agent_session_id AS agentSessionId, log_path AS logPath,
                summary_md AS summaryMd, started_at AS startedAt, ended_at AS endedAt
         FROM script_runs WHERE script_id = ? ORDER BY started_at DESC LIMIT ?`,
      )
      .all(scriptId, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToRun(row));
  }

  updateRun(
    id: string,
    patch: Partial<{
      status: ScriptRunStatus;
      exitCode: number | null;
      stalled: boolean;
      processId: string | null;
      agentSessionId: string | null;
      logPath: string | null;
      summaryMd: string;
      endedAt: string | null;
      actualArgv: string[];
    }>,
  ): ScriptRunRecord {
    const cur = this.getRun(id);
    if (!cur) {
      throw new Error("run not found");
    }
    const next: ScriptRunRecord = {
      ...cur,
      status: patch.status ?? cur.status,
      exitCode: patch.exitCode === undefined ? cur.exitCode : patch.exitCode,
      stalled: patch.stalled ?? cur.stalled,
      processId: patch.processId === undefined ? cur.processId : patch.processId,
      agentSessionId: patch.agentSessionId === undefined ? cur.agentSessionId : patch.agentSessionId,
      logPath: patch.logPath === undefined ? cur.logPath : patch.logPath,
      summaryMd: patch.summaryMd ?? cur.summaryMd,
      endedAt: patch.endedAt === undefined ? cur.endedAt : patch.endedAt,
      actualArgv: patch.actualArgv ?? cur.actualArgv,
    };
    this.requireDb()
      .prepare(
        `UPDATE script_runs SET status = ?, exit_code = ?, stalled = ?, process_id = ?, agent_session_id = ?,
                log_path = ?, summary_md = ?, ended_at = ?, actual_argv_json = ? WHERE id = ?`,
      )
      .run(
        next.status,
        next.exitCode,
        next.stalled ? 1 : 0,
        next.processId,
        next.agentSessionId,
        next.logPath,
        next.summaryMd,
        next.endedAt,
        JSON.stringify(next.actualArgv),
        id,
      );
    return next;
  }

  private rowToRun(row: Record<string, unknown>): ScriptRunRecord {
    return {
      id: String(row.id),
      scriptId: String(row.scriptId),
      intent: String(row.intent || ""),
      knobsJson: String(row.knobsJson || "[]"),
      proposedArgv: parseJsonArray(String(row.proposedArgvJson || "[]")),
      actualArgv: parseJsonArray(String(row.actualArgvJson || "[]")),
      env: parseJsonObject(String(row.envJson || "{}")),
      cwd: String(row.cwd || "."),
      status: String(row.status) as ScriptRunStatus,
      exitCode: row.exitCode == null ? null : Number(row.exitCode),
      stalled: Boolean(row.stalled),
      processId: row.processId ? String(row.processId) : null,
      agentSessionId: row.agentSessionId ? String(row.agentSessionId) : null,
      logPath: row.logPath ? String(row.logPath) : null,
      summaryMd: String(row.summaryMd || ""),
      startedAt: String(row.startedAt),
      endedAt: row.endedAt ? String(row.endedAt) : null,
    };
  }
}

function mergeCatalogKnobs(existing: ScriptKnob[], incoming: ScriptKnob[], userEditedIds: string[]): ScriptKnob[] {
  const edited = new Set(userEditedIds);
  const byId = new Map<string, ScriptKnob>();
  for (const knob of existing) {
    byId.set(knob.id || knob.flag, { ...knob });
  }
  for (const knob of incoming) {
    const id = knob.id || knob.flag?.replace(/^-+/, "");
    if (!id) {
      continue;
    }
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, { ...knob, id });
      continue;
    }
    const keepDescription = edited.has(id) || Boolean((prev.description || "").trim());
    byId.set(id, {
      ...prev,
      flag: knob.flag || prev.flag,
      kind: knob.kind || prev.kind,
      default: knob.default ?? prev.default,
      choices: knob.choices ?? prev.choices,
      required: knob.required ?? prev.required,
      description: keepDescription ? prev.description : knob.description,
      label: edited.has(id) ? prev.label : knob.label || prev.label,
      lastValue: prev.lastValue,
      origin: knob.origin || prev.origin,
      yamlFile: knob.yamlFile || prev.yamlFile,
      yamlKey: knob.yamlKey || prev.yamlKey,
      sampleUsage: knob.sampleUsage || prev.sampleUsage,
    });
  }
  const incomingIds = new Set(incoming.map((knob) => knob.id || knob.flag?.replace(/^-+/, "")).filter(Boolean));
  for (const [id, prev] of [...byId.entries()]) {
    if (prev.origin === "yaml" && !incomingIds.has(id) && !edited.has(id)) {
      byId.delete(id);
    }
  }
  return [...byId.values()];
}
