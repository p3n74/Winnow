import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRebuildLock, ProjectGraphService } from "../src/graph/service.js";
import { openProjectGraphDb, replaceInferredGraph } from "../src/graph/store.js";
import type { GraphNode } from "../src/graph/types.js";

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
