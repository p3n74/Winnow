import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GraphEdge, GraphNode, GraphSummary } from "./types.js";

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS nodes (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  name          TEXT NOT NULL,
  path          TEXT,
  signature     TEXT,
  summary_en    TEXT,
  detail_level  TEXT NOT NULL,
  tags_json     TEXT NOT NULL DEFAULT '[]',
  state         TEXT NOT NULL DEFAULT 'inferred',
  confidence    REAL NOT NULL DEFAULT 0.5,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  id            TEXT PRIMARY KEY,
  from_id       TEXT NOT NULL,
  to_id         TEXT NOT NULL,
  kind          TEXT NOT NULL,
  summary_en    TEXT,
  weight        REAL NOT NULL DEFAULT 1.0,
  state         TEXT NOT NULL DEFAULT 'inferred',
  confidence    REAL NOT NULL DEFAULT 0.5,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_meta (
  key           TEXT PRIMARY KEY,
  value_json    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS correction_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL,
  operation     TEXT NOT NULL,
  payload_json  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recap_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL,
  source        TEXT NOT NULL,
  status        TEXT NOT NULL,
  report_json   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_kind_detail ON nodes(kind, detail_level);
CREATE INDEX IF NOT EXISTS idx_nodes_path ON nodes(path);
CREATE INDEX IF NOT EXISTS idx_edges_from_kind ON edges(from_id, kind);
CREATE INDEX IF NOT EXISTS idx_edges_to_kind ON edges(to_id, kind);
CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);
CREATE INDEX IF NOT EXISTS idx_recap_reports_ts ON recap_reports(ts DESC);
`;

export function graphDbPath(projectRoot: string): string {
  return join(projectRoot, ".winnow", "graph", "graph.db");
}

export function openProjectGraphDb(projectRoot: string): Database.Database {
  const path = graphDbPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  db.prepare(
    "INSERT INTO graph_meta(key, value_json) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
  ).run(JSON.stringify(SCHEMA_VERSION));
  db.prepare(
    "INSERT INTO graph_meta(key, value_json) VALUES('project_root', ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
  ).run(JSON.stringify(projectRoot));
  return db;
}

export function replaceInferredGraph(db: Database.Database, nodes: GraphNode[], edges: GraphEdge[], nowIso: string): void {
  const deleteNodes = db.prepare("DELETE FROM nodes WHERE state = 'inferred'");
  const deleteEdges = db.prepare("DELETE FROM edges WHERE state = 'inferred'");
  const upsertNode = db.prepare(`
    INSERT INTO nodes(id, kind, name, path, signature, summary_en, detail_level, tags_json, state, confidence, created_at, updated_at)
    VALUES (@id, @kind, @name, @path, @signature, @summaryEn, @detailLevel, @tagsJson, @state, @confidence, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      name = excluded.name,
      path = excluded.path,
      signature = excluded.signature,
      summary_en = excluded.summary_en,
      detail_level = excluded.detail_level,
      tags_json = excluded.tags_json,
      confidence = excluded.confidence,
      updated_at = excluded.updated_at
  `);
  const upsertEdge = db.prepare(`
    INSERT INTO edges(id, from_id, to_id, kind, summary_en, weight, state, confidence, evidence_json, created_at, updated_at)
    VALUES (@id, @fromId, @toId, @kind, @summaryEn, @weight, @state, @confidence, @evidenceJson, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      from_id = excluded.from_id,
      to_id = excluded.to_id,
      kind = excluded.kind,
      summary_en = excluded.summary_en,
      weight = excluded.weight,
      confidence = excluded.confidence,
      evidence_json = excluded.evidence_json,
      updated_at = excluded.updated_at
  `);
  const setUpdated = db.prepare(
    "INSERT INTO graph_meta(key, value_json) VALUES('updated_at', ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
  );

  const tx = db.transaction(() => {
    deleteEdges.run();
    deleteNodes.run();
    for (const n of nodes) {
      upsertNode.run(n);
    }
    for (const e of edges) {
      upsertEdge.run(e);
    }
    setUpdated.run(JSON.stringify(nowIso));
  });
  tx();
}

export function queryGraphSummary(db: Database.Database, projectRoot: string): GraphSummary {
  const nodesTotal = (db.prepare("SELECT COUNT(*) AS n FROM nodes").get() as { n: number }).n;
  const edgesTotal = (db.prepare("SELECT COUNT(*) AS n FROM edges").get() as { n: number }).n;
  const nodesByKind = db
    .prepare("SELECT kind, COUNT(*) AS count FROM nodes GROUP BY kind ORDER BY count DESC, kind ASC")
    .all() as { kind: string; count: number }[];
  const edgesByKind = db
    .prepare("SELECT kind, COUNT(*) AS count FROM edges GROUP BY kind ORDER BY count DESC, kind ASC")
    .all() as { kind: string; count: number }[];
  const updatedMeta = db.prepare("SELECT value_json FROM graph_meta WHERE key = 'updated_at'").get() as
    | { value_json: string }
    | undefined;
  let updatedAt: string | null = null;
  if (updatedMeta?.value_json) {
    try {
      updatedAt = JSON.parse(updatedMeta.value_json) as string;
    } catch {
      updatedAt = null;
    }
  }
  return {
    projectRoot,
    schemaVersion: SCHEMA_VERSION,
    nodesTotal,
    edgesTotal,
    nodesByKind,
    edgesByKind,
    updatedAt,
  };
}

