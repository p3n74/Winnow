import type Database from "better-sqlite3";
import { buildDeterministicProjectGraph } from "./scanner.js";
import { augmentWithSemanticInference } from "./inference.js";
import { openProjectGraphDb, queryGraphSummary, replaceInferredGraph } from "./store.js";
import type { BusinessLogicEdgeKind, BusinessLogicGraph, BusinessLogicNodeKind, GraphEdge, GraphNode, GraphSummary } from "./types.js";

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

const RECAP_REPORTS_KEEP = 100;

export type RebuildLock = {
  withRebuildLock: <T>(projectRoot: string, fn: () => Promise<T>) => Promise<T>;
};

/** Join in-flight rebuilds for the same root; queue a different root until the chain drains. */
export function createRebuildLock(): RebuildLock {
  let chain: Promise<void> = Promise.resolve();
  const pendingByRoot = new Map<string, Promise<unknown>>();

  return {
    withRebuildLock<T>(projectRoot: string, fn: () => Promise<T>): Promise<T> {
      const existing = pendingByRoot.get(projectRoot);
      if (existing) {
        return existing as Promise<T>;
      }
      const run = chain.then(fn, fn);
      const tracked = run.finally(() => {
        if (pendingByRoot.get(projectRoot) === tracked) {
          pendingByRoot.delete(projectRoot);
        }
      });
      pendingByRoot.set(projectRoot, tracked);
      chain = tracked.then(
        () => undefined,
        () => undefined,
      );
      return tracked as Promise<T>;
    },
  };
}

function sanitizeIdPart(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function buildBusinessNodeId(kind: BusinessLogicNodeKind, key: string): string {
  return `business::${kind.toLowerCase()}::${sanitizeIdPart(key)}`;
}

function edgeKindToBusiness(kind: GraphEdge["kind"]): BusinessLogicEdgeKind | null {
  if (kind === "drives") return "triggers";
  if (kind === "calls") return "flows_to";
  if (kind === "reads") return "reads";
  if (kind === "writes") return "writes";
  if (kind === "emits") return "emits";
  if (kind === "uses_external") return "interacts_with";
  if (kind === "related_to" || kind === "depends_on") return "enables";
  return null;
}

function toGoalLabel(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  const withoutVerb = spaced.replace(
    /^(start|run|build|refresh|load|save|apply|create|update|delete|sync|submit|process|handle)\s+/i,
    "",
  );
  const words = (withoutVerb || spaced).split(/\s+/).filter(Boolean);
  const selected = words.slice(0, 5).join(" ");
  const label = selected || name;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const ACTION_SYMBOL_PREFIXES = [
  "start",
  "run",
  "build",
  "refresh",
  "load",
  "save",
  "apply",
  "create",
  "update",
  "delete",
  "sync",
  "submit",
  "process",
  "handle",
] as const;
const ACTION_SYMBOL_PREFIX_RE = new RegExp(`^(${ACTION_SYMBOL_PREFIXES.join("|")})`);

const BL_NODE_KIND_LIMIT = 2000;
const BL_SYMBOL_LIMIT = 800;
const BL_EDGE_LIMIT = 1500;
const BL_CALLS_EDGE_LIMIT = 800;
const BL_MISSING_ENDPOINT_CAP = 3000;
const BL_CONCEPT_FILES_CAP = 12;
const BL_WORKFLOWS_CAP = 24;
const BL_WORKFLOW_SYMBOLS_CAP = 12;
const BL_FILE_HINTS_CAP = 40;
const BL_FILE_HINT_SYMBOLS_CAP = 8;

const NODE_COLUMNS = `id, kind, name, path, signature, summary_en AS summaryEn, description_en AS descriptionEn, detail_level AS detailLevel,
  tags_json AS tagsJson, state, confidence, created_at AS createdAt, updated_at AS updatedAt`;
const EDGE_COLUMNS = `e.id AS id, e.from_id AS fromId, e.to_id AS toId, e.kind AS kind, e.summary_en AS summaryEn, e.weight AS weight,
  e.state AS state, e.confidence AS confidence, e.evidence_json AS evidenceJson, e.created_at AS createdAt, e.updated_at AS updatedAt`;

const TEST_PATH_RES = [/\/__tests__\//, /\/tests?\//, /\.test\./, /\.spec\./, /\/mocks?\//, /\/fixtures?\//];

function isTestPath(path: string): boolean {
  const normalized = `/${path.replace(/\\/g, "/").replace(/^\/+/, "")}`;
  return TEST_PATH_RES.some((re) => re.test(normalized));
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Kahn's algorithm; ready queue is stable by node name. Leftover (cyclic) nodes are appended sorted by name. */
function topologicalOrder(
  nodes: BusinessLogicGraph["nodes"],
  indegreeInput: Map<string, number>,
  outgoing: Map<string, string[]>,
): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const indegree = new Map(indegreeInput);
  const cmp = (a: string, b: string): number => {
    const na = byId.get(a);
    const nb = byId.get(b);
    return compareStrings(na?.name ?? "", nb?.name ?? "") || compareStrings(a, b);
  };
  // Sorted descending so the smallest is popped from the end.
  const ready: string[] = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id).sort((a, b) => cmp(b, a));
  const insertReady = (id: string) => {
    let lo = 0;
    let hi = ready.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cmp(ready[mid] as string, id) > 0) lo = mid + 1;
      else hi = mid;
    }
    ready.splice(lo, 0, id);
  };
  const order: string[] = [];
  const emitted = new Set<string>();
  while (ready.length > 0) {
    const id = ready.pop() as string;
    order.push(id);
    emitted.add(id);
    for (const to of outgoing.get(id) ?? []) {
      const next = (indegree.get(to) ?? 0) - 1;
      indegree.set(to, next);
      if (next === 0 && !emitted.has(to)) insertReady(to);
    }
  }
  if (order.length < nodes.length) {
    const leftover = nodes.filter((n) => !emitted.has(n.id)).map((n) => n.id).sort(cmp);
    order.push(...leftover);
  }
  return order;
}

export class ProjectGraphService {
  private currentRoot: string | null = null;
  private db: Database.Database | null = null;
  private readonly rebuildLock = createRebuildLock();

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
    return this.rebuildLock.withRebuildLock(projectRoot, () => this.rebuildNow(projectRoot));
  }

  private async rebuildNow(projectRoot: string): Promise<{
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
        `SELECT id, kind, name, path, signature, summary_en AS summaryEn, description_en AS descriptionEn, detail_level AS detailLevel,
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
        `SELECT id, kind, name, path, signature, summary_en AS summaryEn, description_en AS descriptionEn, detail_level AS detailLevel,
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
        `SELECT id, kind, name, path, signature, summary_en AS summaryEn, description_en AS descriptionEn, detail_level AS detailLevel,
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
    const updateNodeSummary = db.prepare(
      "UPDATE nodes SET summary_en=?, state='user_locked', updated_at=? WHERE id=?",
    );
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
    const persistRecap = db.transaction(() => {
      db.prepare("INSERT INTO recap_reports(ts, source, status, report_json) VALUES(?, ?, ?, ?)").run(
        now,
        source,
        status,
        JSON.stringify(report),
      );
      db.prepare(
        `DELETE FROM recap_reports
         WHERE id NOT IN (
           SELECT id FROM (
             SELECT id FROM recap_reports ORDER BY ts DESC, id DESC LIMIT ?
           )
         )`,
      ).run(RECAP_REPORTS_KEEP);
    });
    persistRecap();
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

  /**
   * Loads the business-map source rows by kind so no single global ORDER BY/LIMIT can evict whole kinds.
   * `promotable` are nodes eligible for business nodes; `nodeById` additionally holds endpoint nodes (files, driven symbols).
   */
  private loadBusinessSource(projectRoot: string): {
    promotable: GraphNode[];
    nodeById: Map<string, GraphNode>;
    edges: GraphEdge[];
    drivenSymbolIds: Set<string>;
  } {
    const db = this.ensureDb(projectRoot);
    const promotable: GraphNode[] = [];
    const nodeById = new Map<string, GraphNode>();
    const addNodes = (rows: GraphNode[], promote: boolean) => {
      for (const row of rows) {
        if (nodeById.has(row.id)) continue;
        nodeById.set(row.id, row);
        if (promote) promotable.push(row);
      }
    };

    for (const kind of ["Concept", "Workflow", "DataEntity", "ExternalSystem"] as const) {
      addNodes(
        db
          .prepare(`SELECT ${NODE_COLUMNS} FROM nodes WHERE kind = ? ORDER BY name ASC, id ASC LIMIT ${BL_NODE_KIND_LIMIT}`)
          .all(kind) as GraphNode[],
        true,
      );
    }
    // Prefer orphan action symbols (no workflow drives them) so driven ones do not use up the symbol budget.
    const prefixClauses = ACTION_SYMBOL_PREFIXES.map(() => "lower(name) LIKE ?").join(" OR ");
    addNodes(
      db
        .prepare(
          `SELECT ${NODE_COLUMNS} FROM nodes
           WHERE kind = 'Symbol' AND (${prefixClauses})
           ORDER BY EXISTS(SELECT 1 FROM edges d WHERE d.kind = 'drives' AND d.to_id = nodes.id) ASC, name ASC, id ASC
           LIMIT ${BL_SYMBOL_LIMIT}`,
        )
        .all(...ACTION_SYMBOL_PREFIXES.map((p) => `${p}%`)) as GraphNode[],
      true,
    );

    const drivenSymbolIds = new Set<string>();
    const rawEdges: GraphEdge[] = [];
    const seenEdgeIds = new Set<string>();
    const collect = (rows: GraphEdge[]) => {
      for (const row of rows) {
        if (seenEdgeIds.has(row.id)) continue;
        seenEdgeIds.add(row.id);
        rawEdges.push(row);
      }
    };

    db.exec("CREATE TEMP TABLE IF NOT EXISTS winnow_bl_ids (id TEXT PRIMARY KEY, kind TEXT NOT NULL)");
    try {
      db.exec("DELETE FROM temp.winnow_bl_ids");
      const insertId = db.prepare("INSERT OR IGNORE INTO temp.winnow_bl_ids(id, kind) VALUES (?, ?)");
      db.transaction(() => {
        for (const n of nodeById.values()) insertId.run(n.id, n.kind);
      })();

      const driven = db
        .prepare(
          `SELECT DISTINCT e.to_id AS id FROM edges e
           WHERE e.kind = 'drives'
             AND e.to_id IN (SELECT id FROM temp.winnow_bl_ids WHERE kind = 'Symbol')
             AND e.from_id IN (SELECT id FROM nodes WHERE kind = 'Workflow')`,
        )
        .all() as Array<{ id: string }>;
      for (const row of driven) drivenSymbolIds.add(row.id);

      const loadedIds = "SELECT id FROM temp.winnow_bl_ids";
      const order = "ORDER BY e.confidence DESC, e.id ASC";
      const queryEdges = (kind: string, condition: string, limit: number): GraphEdge[] =>
        db
          .prepare(`SELECT ${EDGE_COLUMNS} FROM edges e WHERE e.kind = ? AND ${condition} ${order} LIMIT ${limit}`)
          .all(kind) as GraphEdge[];

      // Endpoint-loading kinds: a workflow drives symbols; files relate to concepts.
      const drives = queryEdges(
        "drives",
        "e.from_id IN (SELECT id FROM temp.winnow_bl_ids WHERE kind = 'Workflow')",
        BL_EDGE_LIMIT,
      );
      const relatedTo = queryEdges("related_to", `(e.to_id IN (${loadedIds}) OR e.from_id IN (${loadedIds}))`, BL_EDGE_LIMIT);
      collect(drives);
      collect(relatedTo);

      const bothLoaded = `e.from_id IN (${loadedIds}) AND e.to_id IN (${loadedIds})`;
      for (const kind of ["reads", "writes", "emits", "uses_external", "depends_on"]) {
        collect(queryEdges(kind, bothLoaded, BL_EDGE_LIMIT));
      }
      collect(queryEdges("calls", bothLoaded, BL_CALLS_EDGE_LIMIT));
    } finally {
      db.exec("DROP TABLE IF EXISTS temp.winnow_bl_ids");
    }

    const missing: string[] = [];
    const missingSeen = new Set<string>();
    for (const row of rawEdges.filter((e) => e.kind === "drives" || e.kind === "related_to")) {
      for (const id of [row.fromId, row.toId]) {
        if (nodeById.has(id) || missingSeen.has(id) || missing.length >= BL_MISSING_ENDPOINT_CAP) continue;
        missingSeen.add(id);
        missing.push(id);
      }
    }
    addNodes(this.getNodesByIds(projectRoot, missing), false);
    for (const row of rawEdges) {
      if (row.kind !== "drives") continue;
      if (nodeById.get(row.toId)?.kind === "Symbol") drivenSymbolIds.add(row.toId);
    }

    const edges = rawEdges.filter((e) => nodeById.has(e.fromId) && nodeById.has(e.toId));
    return { promotable, nodeById, edges, drivenSymbolIds };
  }

  private buildConceptToFiles(
    nodes: GraphNode[],
    edges: GraphEdge[],
    nodeById: Map<string, GraphNode>,
  ): Array<{ concept: string; files: string[] }> {
    const filesByConcept = new Map<string, Set<string>>();
    for (const e of edges) {
      if (e.kind !== "related_to") continue;
      const from = nodeById.get(e.fromId);
      const to = nodeById.get(e.toId);
      if (!from || !to || from.kind !== "File" || to.kind !== "Concept" || !from.path) continue;
      const set = filesByConcept.get(to.id) ?? new Set<string>();
      set.add(from.path);
      filesByConcept.set(to.id, set);
    }
    const rows: Array<{ concept: string; files: string[] }> = [];
    for (const concept of nodes) {
      if (concept.kind !== "Concept") continue;
      const paths = filesByConcept.get(concept.id);
      if (!paths || paths.size === 0) continue;
      const files = [...paths]
        .sort((a, b) => Number(isTestPath(a)) - Number(isTestPath(b)) || compareStrings(a, b))
        .slice(0, BL_CONCEPT_FILES_CAP);
      rows.push({ concept: concept.name, files });
    }
    return rows;
  }

  private buildWorkflowToSymbols(
    nodes: GraphNode[],
    edges: GraphEdge[],
    nodeById: Map<string, GraphNode>,
  ): Array<{ workflow: string; symbols: string[] }> {
    const symbolsByWorkflow = new Map<string, Map<string, string>>();
    for (const e of edges) {
      if (e.kind !== "drives") continue;
      const wf = nodeById.get(e.fromId);
      const sym = nodeById.get(e.toId);
      if (!wf || !sym || wf.kind !== "Workflow" || sym.kind !== "Symbol") continue;
      const map = symbolsByWorkflow.get(wf.id) ?? new Map<string, string>();
      map.set(sym.id, sym.name);
      symbolsByWorkflow.set(wf.id, map);
    }
    return nodes
      .filter((n) => n.kind === "Workflow" && symbolsByWorkflow.has(n.id))
      .map((wf) => {
        const names = [...(symbolsByWorkflow.get(wf.id) as Map<string, string>).values()].sort(compareStrings);
        return { workflow: wf.name, count: names.length, symbols: names.slice(0, BL_WORKFLOW_SYMBOLS_CAP) };
      })
      .sort((a, b) => b.count - a.count || compareStrings(a.workflow, b.workflow))
      .slice(0, BL_WORKFLOWS_CAP)
      .map(({ workflow, symbols }) => ({ workflow, symbols }));
  }

  /** Top files by number of contained symbols (SQL aggregate; not limited by the loaded node slice). */
  private buildFileHints(projectRoot: string): Array<{ file: string; symbols: string[] }> {
    const db = this.ensureDb(projectRoot);
    const top = db
      .prepare(
        `SELECT f.id AS id, f.path AS path, COUNT(DISTINCT s.id) AS symbolCount
         FROM edges e
         JOIN nodes f ON f.id = e.from_id AND f.kind = 'File' AND f.path IS NOT NULL
         JOIN nodes s ON s.id = e.to_id AND s.kind = 'Symbol'
         WHERE e.kind = 'contains'
         GROUP BY f.id
         ORDER BY symbolCount DESC, f.path ASC
         LIMIT ${BL_FILE_HINTS_CAP}`,
      )
      .all() as Array<{ id: string; path: string; symbolCount: number }>;
    const symbolStmt = db.prepare(
      `SELECT s.name AS name FROM edges e JOIN nodes s ON s.id = e.to_id
       WHERE e.kind = 'contains' AND e.from_id = ? AND s.kind = 'Symbol'
       ORDER BY s.name ASC LIMIT ${BL_FILE_HINT_SYMBOLS_CAP}`,
    );
    return top.map((row) => ({
      file: row.path,
      symbols: (symbolStmt.all(row.id) as Array<{ name: string }>).map((r) => r.name),
    }));
  }

  businessLogicGraph(projectRoot: string, layer: "full" | "goal" = "full"): BusinessLogicGraph {
    const generatedAt = new Date().toISOString();
    const loaded = this.loadBusinessSource(projectRoot);
    const sourceNodes = loaded.promotable;
    const sourceEdges = loaded.edges;
    const sourceNodeById = loaded.nodeById;

    const businessNodeMap = new Map<string, BusinessLogicGraph["nodes"][number]>();
    const sourceToBusiness = new Map<string, string>();

    const ensureBusinessNode = (source: GraphNode, kind: BusinessLogicNodeKind): string => {
      const existing = sourceToBusiness.get(source.id);
      if (existing) {
        return existing;
      }
      const id = buildBusinessNodeId(kind, source.id);
      businessNodeMap.set(id, {
        id,
        kind,
        name: source.name,
        summaryEn: source.summaryEn,
        descriptionEn: source.descriptionEn,
        confidence: source.confidence,
        sourceNodeIds: [source.id],
      });
      sourceToBusiness.set(source.id, id);
      return id;
    };

    for (const node of sourceNodes) {
      if (node.kind === "Concept") {
        ensureBusinessNode(node, "BusinessCapability");
      } else if (node.kind === "Workflow") {
        ensureBusinessNode(node, "BusinessProcess");
      } else if (node.kind === "DataEntity") {
        ensureBusinessNode(node, "DataObject");
      } else if (node.kind === "ExternalSystem") {
        ensureBusinessNode(node, "ExternalActor");
      } else if (node.kind === "Symbol") {
        const lower = node.name.toLowerCase();
        // Workflow-driven symbols are already represented by their Workflow (BusinessProcess); avoid process+step duplicates.
        if (ACTION_SYMBOL_PREFIX_RE.test(lower) && !loaded.drivenSymbolIds.has(node.id)) {
          ensureBusinessNode(node, "BusinessStep");
        }
      }
    }

    const businessEdgeMap = new Map<string, BusinessLogicGraph["edges"][number]>();
    const upsertBusinessEdge = (
      fromBusinessId: string,
      toBusinessId: string,
      kind: BusinessLogicEdgeKind,
      sourceEdge: GraphEdge,
    ) => {
      const id = `${fromBusinessId}::${kind}::${toBusinessId}`;
      const existing = businessEdgeMap.get(id);
      if (existing) {
        if (!existing.sourceEdgeIds.includes(sourceEdge.id)) {
          existing.sourceEdgeIds.push(sourceEdge.id);
        }
        existing.confidence = Math.max(existing.confidence, sourceEdge.confidence);
        return;
      }
      businessEdgeMap.set(id, {
        id,
        fromId: fromBusinessId,
        toId: toBusinessId,
        kind,
        summaryEn: sourceEdge.summaryEn,
        confidence: sourceEdge.confidence,
        sourceEdgeIds: [sourceEdge.id],
      });
    };

    for (const edge of sourceEdges) {
      const fromSource = sourceNodeById.get(edge.fromId);
      const toSource = sourceNodeById.get(edge.toId);
      if (!fromSource || !toSource) continue;
      const businessKind = edgeKindToBusiness(edge.kind);
      if (!businessKind) continue;

      const fromBusinessId = sourceToBusiness.get(fromSource.id);
      const toBusinessId = sourceToBusiness.get(toSource.id);
      if (!fromBusinessId || !toBusinessId || fromBusinessId === toBusinessId) {
        continue;
      }
      upsertBusinessEdge(fromBusinessId, toBusinessId, businessKind, edge);
    }

    const goalNodeMap = new Map<string, BusinessLogicGraph["nodes"][number]>();
    for (const node of businessNodeMap.values()) {
      if (node.kind !== "BusinessProcess" && node.kind !== "BusinessStep") continue;
      const goalLabel = toGoalLabel(node.name);
      const goalId = buildBusinessNodeId("BusinessGoal", goalLabel.toLowerCase());
      const existingGoal = goalNodeMap.get(goalId);
      if (!existingGoal) {
        goalNodeMap.set(goalId, {
          id: goalId,
          kind: "BusinessGoal",
          name: goalLabel,
          summaryEn: "Higher-level business objective inferred from grouped process/step functions.",
          descriptionEn: "Groups related process and step functions under a single user-facing objective.",
          confidence: node.confidence,
          sourceNodeIds: [...node.sourceNodeIds],
        });
      } else {
        existingGoal.confidence = Math.max(existingGoal.confidence, node.confidence);
        for (const srcId of node.sourceNodeIds) {
          if (!existingGoal.sourceNodeIds.includes(srcId)) {
            existingGoal.sourceNodeIds.push(srcId);
          }
        }
      }

      const edgeId = `${node.id}::achieves::${goalId}`;
      const existingEdge = businessEdgeMap.get(edgeId);
      if (!existingEdge) {
        businessEdgeMap.set(edgeId, {
          id: edgeId,
          fromId: node.id,
          toId: goalId,
          kind: "achieves",
          summaryEn: "Process/step contributes to this higher-level goal.",
          confidence: node.confidence,
          sourceEdgeIds: [],
        });
      }
    }

    for (const [id, goalNode] of goalNodeMap.entries()) {
      businessNodeMap.set(id, goalNode);
    }

    const fullNodes = [...businessNodeMap.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    const allEdgeMap = new Map(businessEdgeMap);

    if (layer === "goal") {
      // Process/step nodes are dropped in the goal layer; bridge kept -> dropped -> kept paths so goals stay connected.
      const droppedKinds = new Set<BusinessLogicNodeKind>(["BusinessProcess", "BusinessStep"]);
      const droppedIds = new Set(fullNodes.filter((n) => droppedKinds.has(n.kind)).map((n) => n.id));
      const inByDropped = new Map<string, BusinessLogicGraph["edges"]>();
      const outByDropped = new Map<string, BusinessLogicGraph["edges"]>();
      for (const e of businessEdgeMap.values()) {
        if (droppedIds.has(e.toId) && !droppedIds.has(e.fromId)) {
          const list = inByDropped.get(e.toId) ?? [];
          list.push(e);
          inByDropped.set(e.toId, list);
        }
        if (droppedIds.has(e.fromId) && !droppedIds.has(e.toId)) {
          const list = outByDropped.get(e.fromId) ?? [];
          list.push(e);
          outByDropped.set(e.fromId, list);
        }
      }
      for (const droppedId of [...droppedIds].sort()) {
        const ins = inByDropped.get(droppedId) ?? [];
        const outs = outByDropped.get(droppedId) ?? [];
        for (const inEdge of ins) {
          for (const outEdge of outs) {
            if (inEdge.fromId === outEdge.toId) continue;
            const kind: BusinessLogicEdgeKind = outEdge.kind === "achieves" ? "achieves" : "enables";
            const id = `${inEdge.fromId}::${kind}::${outEdge.toId}`;
            if (allEdgeMap.has(id)) continue;
            allEdgeMap.set(id, {
              id,
              fromId: inEdge.fromId,
              toId: outEdge.toId,
              kind,
              summaryEn:
                kind === "achieves"
                  ? "Bridged through a process/step: contributes to this higher-level goal."
                  : "Bridged through a process/step: enables this node.",
              confidence: Math.min(inEdge.confidence, outEdge.confidence),
              sourceEdgeIds: [...new Set([...inEdge.sourceEdgeIds, ...outEdge.sourceEdgeIds])],
            });
          }
        }
      }
    }

    const fullEdges = [...allEdgeMap.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

    const keepKinds = new Set<BusinessLogicNodeKind>(
      layer === "goal"
        ? ["BusinessGoal", "BusinessCapability", "DataObject", "ExternalActor"]
        : ["BusinessGoal", "BusinessCapability", "BusinessProcess", "BusinessStep", "DataObject", "ExternalActor"],
    );
    const nodes = fullNodes.filter((n) => keepKinds.has(n.kind));
    const keepNodeIds = new Set(nodes.map((n) => n.id));
    const edges = fullEdges.filter((e) => keepNodeIds.has(e.fromId) && keepNodeIds.has(e.toId));

    const indegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const n of nodes) indegree.set(n.id, 0);
    for (const e of edges) {
      indegree.set(e.toId, (indegree.get(e.toId) ?? 0) + 1);
      const list = outgoing.get(e.fromId) ?? [];
      list.push(e.toId);
      outgoing.set(e.fromId, list);
    }

    const startNodeIds = nodes
      .filter((n) => (layer === "goal" ? n.kind === "BusinessGoal" : n.kind === "BusinessProcess" || n.kind === "BusinessStep"))
      .filter((n) => (indegree.get(n.id) ?? 0) === 0)
      .map((n) => n.id);
    const topologicalHintIds = topologicalOrder(nodes, indegree, outgoing);

    const conceptToFiles = this.buildConceptToFiles(sourceNodes, sourceEdges, sourceNodeById);
    const workflowToSymbols = this.buildWorkflowToSymbols(sourceNodes, sourceEdges, sourceNodeById);
    const fileHints = this.buildFileHints(projectRoot);

    const keyCapabilities = nodes
      .filter((n) => n.kind === "BusinessCapability")
      .map((n) => n.name)
      .slice(0, 8);
    const keyGoals = nodes
      .filter((n) => n.kind === "BusinessGoal")
      .map((n) => n.name)
      .slice(0, 8);
    const keyDataObjects = nodes
      .filter((n) => n.kind === "DataObject")
      .map((n) => n.name)
      .slice(0, 8);

    const lookupHints = [
      "Start with `conceptToFiles` to jump to relevant files by concept.",
      "Use `workflowToSymbols` to locate action entrypoints before exploring internals.",
      "Use `fileHints` to target symbol-level lookups and avoid full-repo scans.",
    ];

    return {
      projectRoot,
      generatedAt,
      nodes,
      edges,
      overview: {
        projectSummary:
          "High-level business map inferred from code structure, workflows, and function behavior. Use this as the first-pass project orientation before deep code inspection.",
        keyCapabilities,
        keyGoals,
        keyDataObjects,
      },
      heuristicIndex: {
        conceptToFiles,
        workflowToSymbols,
        fileHints,
        lookupHints,
      },
      flowchart: {
        startNodeIds,
        topologicalHintIds,
      },
    };
  }

  /**
   * LIKE search across name, path, and summary (deduped by node id).
   * Short or test-ish terms skip `path` matching so `test` does not match every `*.test.ts` file.
   */
  searchNodesByTerms(projectRoot: string, terms: string[], limit: number): GraphNode[] {
    const db = this.ensureDb(projectRoot);
    const pathMatchMinLen = 5;
    const neverPathMatch = new Set([
      "e2e",
      "fixture",
      "fixtures",
      "jest",
      "mock",
      "mocks",
      "spec",
      "specs",
      "test",
      "tests",
      "vitest",
    ]);
    const safeTerms = terms
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length >= 3)
      .map((t) => t.replace(/%/g, "").replace(/_/g, ""))
      .filter((t) => t.length >= 3)
      .slice(0, 16);
    if (safeTerms.length === 0 || limit <= 0) {
      return [];
    }
    const clauses: string[] = [];
    const args: unknown[] = [];
    for (const t of safeTerms) {
      const pattern = `%${t}%`;
      const usePath = t.length >= pathMatchMinLen && !neverPathMatch.has(t);
      if (usePath) {
        clauses.push(
          "(LOWER(name) LIKE ? OR LOWER(COALESCE(path, '')) LIKE ? OR LOWER(COALESCE(summary_en, '')) LIKE ?)",
        );
        args.push(pattern, pattern, pattern);
      } else {
        clauses.push("(LOWER(name) LIKE ? OR LOWER(COALESCE(summary_en, '')) LIKE ?)");
        args.push(pattern, pattern);
      }
    }
    const where = clauses.join(" OR ");
    const lim = Math.max(1, Math.min(300, Math.floor(limit)));
    const rows = db
      .prepare(
        `SELECT id, kind, name, path, signature, summary_en AS summaryEn, description_en AS descriptionEn, detail_level AS detailLevel,
         tags_json AS tagsJson, state, confidence, created_at AS createdAt, updated_at AS updatedAt
         FROM nodes WHERE ${where}
         ORDER BY CASE kind WHEN 'Symbol' THEN 0 WHEN 'File' THEN 1 WHEN 'Workflow' THEN 2 ELSE 3 END, LENGTH(name) ASC LIMIT ${lim}`,
      )
      .all(...args) as GraphNode[];
    const byId = new Map<string, GraphNode>();
    for (const n of rows) {
      byId.set(n.id, n);
    }
    return [...byId.values()];
  }

  listEdgesIncidentToNodes(projectRoot: string, nodeIds: string[], limit: number): GraphEdge[] {
    const db = this.ensureDb(projectRoot);
    const unique = [...new Set(nodeIds.map((id) => id.trim()).filter(Boolean))];
    if (unique.length === 0 || limit <= 0) {
      return [];
    }
    const seen = new Set<string>();
    const out: GraphEdge[] = [];
    const chunkSize = 40;
    const maxTotal = Math.max(1, Math.min(500, Math.floor(limit)));
    for (let i = 0; i < unique.length && out.length < maxTotal; i += chunkSize) {
      const slice = unique.slice(i, i + chunkSize);
      const ph = slice.map(() => "?").join(",");
      const remaining = maxTotal - out.length;
      const rows = db
        .prepare(
          `SELECT id, from_id AS fromId, to_id AS toId, kind, summary_en AS summaryEn, weight, state, confidence,
           evidence_json AS evidenceJson, created_at AS createdAt, updated_at AS updatedAt
           FROM edges WHERE from_id IN (${ph}) OR to_id IN (${ph}) LIMIT ${remaining}`,
        )
        .all(...slice, ...slice) as GraphEdge[];
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        out.push(row);
        if (out.length >= maxTotal) {
          break;
        }
      }
    }
    return out;
  }

  getNodesByIds(projectRoot: string, nodeIds: string[]): GraphNode[] {
    const db = this.ensureDb(projectRoot);
    const unique = [...new Set(nodeIds.map((id) => id.trim()).filter(Boolean))];
    if (unique.length === 0) {
      return [];
    }
    const out: GraphNode[] = [];
    const chunkSize = 80;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const slice = unique.slice(i, i + chunkSize);
      const ph = slice.map(() => "?").join(",");
      const rows = db
        .prepare(
          `SELECT id, kind, name, path, signature, summary_en AS summaryEn, description_en AS descriptionEn, detail_level AS detailLevel,
           tags_json AS tagsJson, state, confidence, created_at AS createdAt, updated_at AS updatedAt
           FROM nodes WHERE id IN (${ph})`,
        )
        .all(...slice) as GraphNode[];
      out.push(...rows);
    }
    return out;
  }

  getFileNodesByPaths(projectRoot: string, paths: string[], limit: number): GraphNode[] {
    const db = this.ensureDb(projectRoot);
    const unique = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
    if (unique.length === 0 || limit <= 0) {
      return [];
    }
    const out: GraphNode[] = [];
    const chunkSize = 40;
    for (let i = 0; i < unique.length && out.length < limit; i += chunkSize) {
      const slice = unique.slice(i, i + chunkSize);
      const ph = slice.map(() => "?").join(",");
      const remaining = limit - out.length;
      const rows = db
        .prepare(
          `SELECT id, kind, name, path, signature, summary_en AS summaryEn, description_en AS descriptionEn, detail_level AS detailLevel,
           tags_json AS tagsJson, state, confidence, created_at AS createdAt, updated_at AS updatedAt
           FROM nodes WHERE kind = 'File' AND path IN (${ph}) LIMIT ${remaining}`,
        )
        .all(...slice) as GraphNode[];
      out.push(...rows);
    }
    return out;
  }
}

