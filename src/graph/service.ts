import type Database from "better-sqlite3";
import { buildDeterministicProjectGraph } from "./scanner.js";
import { augmentWithSemanticInference } from "./inference.js";
import { openProjectGraphDb, queryGraphSummary, replaceInferredGraph } from "./store.js";
import type { GraphEdge, GraphNode, GraphSummary } from "./types.js";

type NodeQueryOpts = {
  kind?: string;
  detailLevel?: string;
  limit?: number;
};

type EdgeQueryOpts = {
  kind?: string;
  fromId?: string;
  toId?: string;
  limit?: number;
};

type GraphCorrectionOp =
  | { type: "lock_edge"; edgeId: string }
  | { type: "remove_edge"; edgeId: string }
  | {
      type: "upsert_edge";
      edge: {
        fromId: string;
        toId: string;
        kind: GraphEdge["kind"];
        summaryEn?: string;
      };
    }
  | { type: "update_node_summary"; nodeId: string; summaryEn: string };

type GraphRecapReport = {
  ts: string;
  source: "manual_reconcile" | "post_correction" | "rumination";
  status: "ok" | "conflict";
  findings: string[];
};

export class ProjectGraphService {
  private currentRoot: string | null = null;
  private db: Database.Database | null = null;

  private ensureDb(projectRoot: string): Database.Database {
    if (!this.db || this.currentRoot !== projectRoot) {
      if (this.db) {
        try {
          this.db.close();
        } catch {
          // ignore
        }
      }
      this.db = openProjectGraphDb(projectRoot);
      this.currentRoot = projectRoot;
    }
    return this.db;
  }

  async rebuild(projectRoot: string): Promise<{
    ok: true;
    projectRoot: string;
    generatedAt: string;
    nodes: number;
    edges: number;
  }> {
    const db = this.ensureDb(projectRoot);
    const built = await buildDeterministicProjectGraph(projectRoot);
    const inferred = augmentWithSemanticInference(built.nodes, built.edges, built.generatedAt);
    replaceInferredGraph(db, inferred.nodes, inferred.edges, built.generatedAt);
    return {
      ok: true,
      projectRoot,
      generatedAt: built.generatedAt,
      nodes: inferred.nodes.length,
      edges: inferred.edges.length,
    };
  }

  summary(projectRoot: string): GraphSummary {
    const db = this.ensureDb(projectRoot);
    return queryGraphSummary(db, projectRoot);
  }

  listNodes(projectRoot: string, opts: NodeQueryOpts): GraphNode[] {
    const db = this.ensureDb(projectRoot);
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (opts.kind?.trim()) {
      clauses.push("kind = ?");
      args.push(opts.kind.trim());
    }
    if (opts.detailLevel?.trim()) {
      clauses.push("detail_level = ?");
      args.push(opts.detailLevel.trim());
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(2000, Math.floor(opts.limit ?? 500)));
    return db
      .prepare(
        `SELECT id, kind, name, path, signature, summary_en AS summaryEn, detail_level AS detailLevel,
         tags_json AS tagsJson, state, confidence, created_at AS createdAt, updated_at AS updatedAt
         FROM nodes ${where} ORDER BY kind ASC, name ASC LIMIT ${limit}`,
      )
      .all(...args) as GraphNode[];
  }

  listEdges(projectRoot: string, opts: EdgeQueryOpts): GraphEdge[] {
    const db = this.ensureDb(projectRoot);
    const clauses: string[] = [];
    const args: unknown[] = [];
    if (opts.kind?.trim()) {
      clauses.push("kind = ?");
      args.push(opts.kind.trim());
    }
    if (opts.fromId?.trim()) {
      clauses.push("from_id = ?");
      args.push(opts.fromId.trim());
    }
    if (opts.toId?.trim()) {
      clauses.push("to_id = ?");
      args.push(opts.toId.trim());
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(4000, Math.floor(opts.limit ?? 1000)));
    return db
      .prepare(
        `SELECT id, from_id AS fromId, to_id AS toId, kind, summary_en AS summaryEn, weight, state, confidence,
         evidence_json AS evidenceJson, created_at AS createdAt, updated_at AS updatedAt
         FROM edges ${where} ORDER BY kind ASC, from_id ASC, to_id ASC LIMIT ${limit}`,
      )
      .all(...args) as GraphEdge[];
  }

  neighbors(projectRoot: string, nodeId: string): {
    center: GraphNode | null;
    nodes: GraphNode[];
    edges: GraphEdge[];
  } {
    const db = this.ensureDb(projectRoot);
    const center = db
      .prepare(
        `SELECT id, kind, name, path, signature, summary_en AS summaryEn, detail_level AS detailLevel,
         tags_json AS tagsJson, state, confidence, created_at AS createdAt, updated_at AS updatedAt
         FROM nodes WHERE id = ?`,
      )
      .get(nodeId) as GraphNode | undefined;
    if (!center) {
      return { center: null, nodes: [], edges: [] };
    }
    const edges = db
      .prepare(
        `SELECT id, from_id AS fromId, to_id AS toId, kind, summary_en AS summaryEn, weight, state, confidence,
         evidence_json AS evidenceJson, created_at AS createdAt, updated_at AS updatedAt
         FROM edges WHERE from_id = ? OR to_id = ? LIMIT 2000`,
      )
      .all(nodeId, nodeId) as GraphEdge[];
    const neighborIds = new Set<string>([nodeId]);
    for (const edge of edges) {
      neighborIds.add(edge.fromId);
      neighborIds.add(edge.toId);
    }
    const placeholders = [...neighborIds].map(() => "?").join(",");
    const nodes = db
      .prepare(
        `SELECT id, kind, name, path, signature, summary_en AS summaryEn, detail_level AS detailLevel,
         tags_json AS tagsJson, state, confidence, created_at AS createdAt, updated_at AS updatedAt
         FROM nodes WHERE id IN (${placeholders})`,
      )
      .all(...neighborIds) as GraphNode[];
    return { center, nodes, edges };
  }

  applyCorrections(projectRoot: string, operations: GraphCorrectionOp[]): {
    ok: true;
    applied: number;
    report: GraphRecapReport;
  } {
    const db = this.ensureDb(projectRoot);
    const now = new Date().toISOString();
    const getEdge = db.prepare("SELECT id, from_id AS fromId, to_id AS toId, kind FROM edges WHERE id = ?");
    const lockEdge = db.prepare("UPDATE edges SET state='user_locked', updated_at=? WHERE id=?");
    const deleteEdge = db.prepare("DELETE FROM edges WHERE id=?");
    const upsertEdge = db.prepare(`
      INSERT INTO edges(id, from_id, to_id, kind, summary_en, weight, state, confidence, evidence_json, created_at, updated_at)
      VALUES (@id, @fromId, @toId, @kind, @summaryEn, 1.0, 'user_locked', 1.0, @evidenceJson, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        from_id=excluded.from_id,
        to_id=excluded.to_id,
        kind=excluded.kind,
        summary_en=excluded.summary_en,
        state='user_locked',
        confidence=1.0,
        updated_at=excluded.updated_at
    `);
    const updateNodeSummary = db.prepare("UPDATE nodes SET summary_en=?, updated_at=? WHERE id=?");
    const insertCorrection = db.prepare(
      "INSERT INTO correction_events(ts, operation, payload_json) VALUES(?, ?, ?)",
    );

    const tx = db.transaction(() => {
      let applied = 0;
      for (const op of operations) {
        if (op.type === "lock_edge") {
          const exists = getEdge.get(op.edgeId) as { id: string } | undefined;
          if (!exists) continue;
          lockEdge.run(now, op.edgeId);
          insertCorrection.run(now, op.type, JSON.stringify(op));
          applied += 1;
        } else if (op.type === "remove_edge") {
          const exists = getEdge.get(op.edgeId) as { id: string } | undefined;
          if (!exists) continue;
          deleteEdge.run(op.edgeId);
          insertCorrection.run(now, op.type, JSON.stringify(op));
          applied += 1;
        } else if (op.type === "upsert_edge") {
          const id = `${op.edge.fromId}::${op.edge.kind}::${op.edge.toId}`;
          upsertEdge.run({
            id,
            fromId: op.edge.fromId,
            toId: op.edge.toId,
            kind: op.edge.kind,
            summaryEn: op.edge.summaryEn ?? "User-provided correction edge.",
            evidenceJson: JSON.stringify([{ type: "user_correction" }]),
            createdAt: now,
            updatedAt: now,
          });
          insertCorrection.run(now, op.type, JSON.stringify(op));
          applied += 1;
        } else if (op.type === "update_node_summary") {
          updateNodeSummary.run(op.summaryEn, now, op.nodeId);
          insertCorrection.run(now, op.type, JSON.stringify(op));
          applied += 1;
        }
      }
      return applied;
    });

    const applied = tx();
    const report = this.reconcile(projectRoot, "post_correction");
    return { ok: true, applied, report };
  }

  reconcile(projectRoot: string, source: GraphRecapReport["source"]): GraphRecapReport {
    const db = this.ensureDb(projectRoot);
    const now = new Date().toISOString();
    const findings: string[] = [];

    const danglingLockedEdges = db
      .prepare(
        `SELECT e.id AS id, e.from_id AS fromId, e.to_id AS toId
         FROM edges e
         LEFT JOIN nodes nf ON nf.id = e.from_id
         LEFT JOIN nodes nt ON nt.id = e.to_id
         WHERE e.state='user_locked' AND (nf.id IS NULL OR nt.id IS NULL)`,
      )
      .all() as Array<{ id: string; fromId: string; toId: string }>;
    for (const row of danglingLockedEdges) {
      findings.push(`Locked edge ${row.id} is dangling (missing endpoint node).`);
    }

    const invalidLockedCalls = db
      .prepare(
        `SELECT e.id AS id, nf.kind AS fromKind, nt.kind AS toKind
         FROM edges e
         JOIN nodes nf ON nf.id = e.from_id
         JOIN nodes nt ON nt.id = e.to_id
         WHERE e.state='user_locked' AND e.kind='calls' AND (nf.kind != 'Symbol' OR nt.kind != 'Symbol')`,
      )
      .all() as Array<{ id: string; fromKind: string; toKind: string }>;
    for (const row of invalidLockedCalls) {
      findings.push(`Locked calls edge ${row.id} connects non-symbol nodes (${row.fromKind} -> ${row.toKind}).`);
    }

    const status: GraphRecapReport["status"] = findings.length === 0 ? "ok" : "conflict";
    const report: GraphRecapReport = { ts: now, source, status, findings };
    db.prepare("INSERT INTO recap_reports(ts, source, status, report_json) VALUES(?, ?, ?, ?)").run(
      now,
      source,
      status,
      JSON.stringify(report),
    );
    return report;
  }

  latestRecaps(projectRoot: string, limit = 20): GraphRecapReport[] {
    const db = this.ensureDb(projectRoot);
    const lim = Math.max(1, Math.min(200, Math.floor(limit)));
    const rows = db
      .prepare("SELECT report_json FROM recap_reports ORDER BY ts DESC, id DESC LIMIT ?")
      .all(lim) as Array<{ report_json: string }>;
    const out: GraphRecapReport[] = [];
    for (const r of rows) {
      try {
        out.push(JSON.parse(r.report_json) as GraphRecapReport);
      } catch {
        // ignore bad row
      }
    }
    return out;
  }

  ruminate(projectRoot: string): GraphRecapReport {
    const db = this.ensureDb(projectRoot);
    const now = new Date().toISOString();
    db.prepare(
      `DELETE FROM edges
       WHERE state='inferred'
         AND (from_id NOT IN (SELECT id FROM nodes) OR to_id NOT IN (SELECT id FROM nodes))`,
    ).run();
    db.prepare(
      "UPDATE edges SET confidence = MIN(0.99, confidence + 0.01), updated_at = ? WHERE state='inferred' AND confidence < 0.8",
    ).run(now);
    return this.reconcile(projectRoot, "rumination");
  }
}

