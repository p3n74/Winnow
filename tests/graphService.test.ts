import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRebuildLock, ProjectGraphService } from "../src/graph/service.js";
import { openProjectGraphDb, replaceInferredGraph } from "../src/graph/store.js";
import type { GraphEdge, GraphNode } from "../src/graph/types.js";

async function tmpProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "winnow-graph-svc-"));
}

function sampleNode(overrides: Partial<GraphNode> = {}): GraphNode {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "symbol::AuthService",
    kind: "Symbol",
    name: "AuthService",
    path: "src/auth.ts",
    signature: "function AuthService()",
    summaryEn: "inferred summary",
    descriptionEn: "inferred description",
    detailLevel: "L2",
    tagsJson: "[]",
    state: "inferred",
    confidence: 0.5,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("applyCorrections update_node_summary", () => {
  it("locks the user summary so rebuild cannot overwrite it", async () => {
    const dir = await tmpProject();
    const db = openProjectGraphDb(dir);
    const node = sampleNode();
    replaceInferredGraph(db, [node], [], "2026-01-01T00:00:00.000Z");

    const svc = new ProjectGraphService();
    const applied = svc.applyCorrections(dir, [
      { type: "update_node_summary", nodeId: node.id, summaryEn: "user-authored summary" },
    ]);
    expect(applied.ok).toBe(true);
    expect(applied.applied).toBe(1);

    const locked = svc.getNodesByIds(dir, [node.id]);
    expect(locked).toHaveLength(1);
    expect(locked[0]?.summaryEn).toBe("user-authored summary");
    expect(locked[0]?.state).toBe("user_locked");

    replaceInferredGraph(
      db,
      [sampleNode({ summaryEn: "scanner overwrite", state: "inferred", updatedAt: "2026-01-03T00:00:00.000Z" })],
      [],
      "2026-01-03T00:00:00.000Z",
    );

    const afterRebuild = svc.getNodesByIds(dir, [node.id]);
    expect(afterRebuild[0]?.summaryEn).toBe("user-authored summary");
    expect(afterRebuild[0]?.state).toBe("user_locked");
    db.close();
  });
});

describe("createRebuildLock", () => {
  it("joins concurrent callers for the same projectRoot", async () => {
    const lock = createRebuildLock();
    let calls = 0;
    const gate = deferred();
    const fn = async (): Promise<string> => {
      calls += 1;
      await gate.promise;
      return "done";
    };

    const p1 = lock.withRebuildLock("/same", fn);
    const p2 = lock.withRebuildLock("/same", fn);
    gate.resolve();
    await expect(Promise.all([p1, p2])).resolves.toEqual(["done", "done"]);
    expect(calls).toBe(1);
  });

  it("queues a different projectRoot until the in-flight rebuild finishes", async () => {
    const lock = createRebuildLock();
    const gate = deferred();
    const order: string[] = [];

    const pA = lock.withRebuildLock("/a", async () => {
      order.push("a-start");
      await gate.promise;
      order.push("a-end");
      return "a";
    });
    const pB = lock.withRebuildLock("/b", async () => {
      order.push("b-start");
      order.push("b-end");
      return "b";
    });

    await Promise.resolve();
    expect(order).toEqual(["a-start"]);
    gate.resolve();
    await expect(Promise.all([pA, pB])).resolves.toEqual(["a", "b"]);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });
});

describe("ProjectGraphService.rebuild single-flight", () => {
  it("completes two concurrent rebuilds of a tiny fixture without throwing", async () => {
    const dir = await tmpProject();
    await writeFile(join(dir, "hello.ts"), "export function hello() { return 1; }\n");
    const svc = new ProjectGraphService();
    const [a, b] = await Promise.all([svc.rebuild(dir), svc.rebuild(dir)]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.nodes).toBeGreaterThan(0);
    expect(b.nodes).toBe(a.nodes);
  });
});

describe("reconcile recap_reports cap", () => {
  it("keeps at most 100 recap rows after many inserts", async () => {
    const dir = await tmpProject();
    const svc = new ProjectGraphService();
    for (let i = 0; i < 120; i += 1) {
      svc.reconcile(dir, "manual_reconcile");
    }
    const recaps = svc.latestRecaps(dir, 200);
    expect(recaps.length).toBeLessThanOrEqual(100);
    expect(recaps.length).toBe(100);

    const db = openProjectGraphDb(dir);
    try {
      const count = (db.prepare("SELECT COUNT(*) AS n FROM recap_reports").get() as { n: number }).n;
      expect(count).toBeLessThanOrEqual(100);
    } finally {
      db.close();
    }
  });
});

function sampleEdge(fromId: string, kind: GraphEdge["kind"], toId: string, overrides: Partial<GraphEdge> = {}): GraphEdge {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: `${fromId}::${kind}::${toId}`,
    fromId,
    toId,
    kind,
    summaryEn: null,
    weight: 1,
    state: "inferred",
    confidence: 0.8,
    evidenceJson: "[]",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const NOW = "2026-01-01T00:00:00.000Z";

describe("businessLogicGraph kind-balanced loading", () => {
  it("keeps drives and related_to semantics when contains edges exceed the old 4000 cap", async () => {
    const dir = await tmpProject();
    const db = openProjectGraphDb(dir);
    const nodes: GraphNode[] = [
      sampleNode({ id: "file::big", kind: "File", name: "big.ts", path: "src/big.ts" }),
      sampleNode({ id: "file::concept", kind: "File", name: "billing.ts", path: "src/billing.ts" }),
      sampleNode({ id: "concept::billing", kind: "Concept", name: "Billing" }),
      sampleNode({ id: "workflow::checkout", kind: "Workflow", name: "Checkout flow" }),
      sampleNode({ id: "symbol::zzDriven", kind: "Symbol", name: "zzDrivenEntry", path: "src/big.ts" }),
    ];
    const edges: GraphEdge[] = [
      sampleEdge("workflow::checkout", "drives", "symbol::zzDriven"),
      sampleEdge("file::concept", "related_to", "concept::billing"),
    ];
    for (let i = 0; i < 4100; i += 1) {
      const id = `symbol::filler${String(i).padStart(5, "0")}`;
      nodes.push(sampleNode({ id, kind: "Symbol", name: `filler${i}`, path: "src/big.ts" }));
      edges.push(sampleEdge("file::big", "contains", id));
    }
    replaceInferredGraph(db, nodes, edges, NOW);

    const svc = new ProjectGraphService();
    const graph = svc.businessLogicGraph(dir, "full");
    expect(graph.heuristicIndex.workflowToSymbols).toContainEqual({ workflow: "Checkout flow", symbols: ["zzDrivenEntry"] });
    expect(graph.heuristicIndex.conceptToFiles).toContainEqual({ concept: "Billing", files: ["src/billing.ts"] });
    expect(graph.heuristicIndex.fileHints[0]?.file).toBe("src/big.ts");
    expect(graph.heuristicIndex.lookupHints).toHaveLength(3);
    db.close();
  });

  it("orders conceptToFiles with non-test paths first", async () => {
    const dir = await tmpProject();
    const db = openProjectGraphDb(dir);
    const nodes = [
      sampleNode({ id: "concept::auth", kind: "Concept", name: "Auth" }),
      sampleNode({ id: "file::t", kind: "File", name: "a.test.ts", path: "src/a.test.ts" }),
      sampleNode({ id: "file::s", kind: "File", name: "z.ts", path: "src/z.ts" }),
    ];
    replaceInferredGraph(
      db,
      nodes,
      [sampleEdge("file::t", "related_to", "concept::auth"), sampleEdge("file::s", "related_to", "concept::auth")],
      NOW,
    );
    const graph = new ProjectGraphService().businessLogicGraph(dir, "full");
    expect(graph.heuristicIndex.conceptToFiles).toEqual([{ concept: "Auth", files: ["src/z.ts", "src/a.test.ts"] }]);
    db.close();
  });

  it("does not promote workflow-driven symbols to BusinessStep but still promotes orphan action symbols", async () => {
    const dir = await tmpProject();
    const db = openProjectGraphDb(dir);
    replaceInferredGraph(
      db,
      [
        sampleNode({ id: "workflow::sync", kind: "Workflow", name: "Sync flow" }),
        sampleNode({ id: "symbol::runSync", kind: "Symbol", name: "runSync" }),
        sampleNode({ id: "symbol::buildReport", kind: "Symbol", name: "buildReport" }),
      ],
      [sampleEdge("workflow::sync", "drives", "symbol::runSync")],
      NOW,
    );
    const graph = new ProjectGraphService().businessLogicGraph(dir, "full");
    const steps = graph.nodes.filter((n) => n.kind === "BusinessStep").map((n) => n.name);
    expect(steps).toEqual(["buildReport"]);
    expect(graph.nodes.some((n) => n.kind === "BusinessProcess" && n.name === "Sync flow")).toBe(true);
    db.close();
  });
});

describe("businessLogicGraph goal layer", () => {
  it("bridges capability -> process -> goal into capability -achieves-> goal", async () => {
    const dir = await tmpProject();
    const db = openProjectGraphDb(dir);
    replaceInferredGraph(
      db,
      [
        sampleNode({ id: "concept::billing", kind: "Concept", name: "Billing" }),
        sampleNode({ id: "workflow::checkout", kind: "Workflow", name: "Checkout flow" }),
      ],
      [sampleEdge("concept::billing", "related_to", "workflow::checkout", { confidence: 0.6 })],
      NOW,
    );
    const svc = new ProjectGraphService();
    const goalGraph = svc.businessLogicGraph(dir, "goal");
    expect(goalGraph.nodes.some((n) => n.kind === "BusinessProcess" || n.kind === "BusinessStep")).toBe(false);
    const capability = goalGraph.nodes.find((n) => n.kind === "BusinessCapability");
    const goal = goalGraph.nodes.find((n) => n.kind === "BusinessGoal");
    expect(capability).toBeDefined();
    expect(goal).toBeDefined();
    const bridge = goalGraph.edges.find((e) => e.toId === goal?.id && e.fromId === capability?.id);
    expect(bridge?.kind).toBe("achieves");
    expect(bridge?.confidence).toBeLessThanOrEqual(0.6);
    expect(bridge?.sourceEdgeIds).toContain("concept::billing::related_to::workflow::checkout");
    expect(goalGraph.flowchart.topologicalHintIds).toHaveLength(goalGraph.nodes.length);

    const fullGraph = svc.businessLogicGraph(dir, "full");
    expect(fullGraph.nodes.some((n) => n.kind === "BusinessProcess")).toBe(true);
    db.close();
  });
});

describe("businessLogicGraph topologicalHintIds", () => {
  it("places a source node before its target even when the target sorts first by name", async () => {
    const dir = await tmpProject();
    const db = openProjectGraphDb(dir);
    replaceInferredGraph(
      db,
      [
        sampleNode({ id: "concept::a", kind: "Concept", name: "Zeta source" }),
        sampleNode({ id: "concept::b", kind: "Concept", name: "Alpha target" }),
      ],
      [sampleEdge("concept::a", "depends_on", "concept::b")],
      NOW,
    );
    const graph = new ProjectGraphService().businessLogicGraph(dir, "full");
    const a = graph.nodes.find((n) => n.name === "Zeta source")?.id as string;
    const b = graph.nodes.find((n) => n.name === "Alpha target")?.id as string;
    expect(graph.edges.some((e) => e.fromId === a && e.toId === b)).toBe(true);
    const order = graph.flowchart.topologicalHintIds;
    expect(order.indexOf(a)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
    db.close();
  });

  it("appends cyclic leftovers instead of dropping them", async () => {
    const dir = await tmpProject();
    const db = openProjectGraphDb(dir);
    replaceInferredGraph(
      db,
      [
        sampleNode({ id: "concept::a", kind: "Concept", name: "Alpha" }),
        sampleNode({ id: "concept::b", kind: "Concept", name: "Beta" }),
      ],
      [sampleEdge("concept::a", "depends_on", "concept::b"), sampleEdge("concept::b", "depends_on", "concept::a")],
      NOW,
    );
    const graph = new ProjectGraphService().businessLogicGraph(dir, "full");
    expect(new Set(graph.flowchart.topologicalHintIds)).toEqual(new Set(graph.nodes.map((n) => n.id)));
    expect(graph.flowchart.topologicalHintIds).toHaveLength(graph.nodes.length);
    db.close();
  });
});
