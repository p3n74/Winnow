import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildAgentGraphContextPreamble } from "../src/graph/agentGraphSeed.js";
import { ProjectGraphService } from "../src/graph/service.js";
import { openProjectGraphDb, replaceInferredGraph } from "../src/graph/store.js";
import type { GraphNode } from "../src/graph/types.js";

const PREAMBLE_MAX_CHARS = 4500;

async function tmpProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "winnow-graph-seed-"));
}

function sampleNode(overrides: Partial<GraphNode> = {}): GraphNode {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "symbol::AuthService",
    kind: "Symbol",
    name: "AuthService",
    path: "src/auth.ts",
    signature: "function AuthService()",
    summaryEn: "Handles session tokens for signed-in users.",
    descriptionEn: "Auth entrypoint.",
    detailLevel: "L2",
    tagsJson: "[]",
    state: "inferred",
    confidence: 0.8,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("buildAgentGraphContextPreamble", () => {
  it("returns a capped non-empty preamble without calling businessLogicGraph", async () => {
    const dir = await tmpProject();
    const db = openProjectGraphDb(dir);
    replaceInferredGraph(db, [sampleNode()], [], "2026-01-01T00:00:00.000Z");
    db.close();

    const svc = new ProjectGraphService();
    const spy = vi.spyOn(svc, "businessLogicGraph");

    const preamble = buildAgentGraphContextPreamble(svc, dir, "How does AuthService work?");
    expect(spy).not.toHaveBeenCalled();
    expect(typeof preamble).toBe("string");
    expect(preamble.length).toBeGreaterThan(0);
    expect(preamble.length).toBeLessThanOrEqual(PREAMBLE_MAX_CHARS);
    expect(preamble).toMatch(/AuthService/);
    spy.mockRestore();
  });

  it("skips empty graphs, low-signal prompts, and git meta prompts", async () => {
    const emptyDir = await tmpProject();
    const svc = new ProjectGraphService();
    const spy = vi.spyOn(svc, "businessLogicGraph");

    expect(buildAgentGraphContextPreamble(svc, emptyDir, "How does AuthService work?")).toBe("");

    const seeded = await tmpProject();
    const db = openProjectGraphDb(seeded);
    replaceInferredGraph(db, [sampleNode()], [], "2026-01-01T00:00:00.000Z");
    db.close();

    expect(buildAgentGraphContextPreamble(svc, seeded, "fix bug")).toBe("");
    expect(buildAgentGraphContextPreamble(svc, seeded, "write a commit message for these changes")).toBe("");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
