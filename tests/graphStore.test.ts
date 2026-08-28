import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openProjectGraphDb, queryGraphSummary, replaceInferredGraph } from "../src/graph/store.js";
import type { GraphNode } from "../src/graph/types.js";

async function tmpProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "winnow-graph-store-"));
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

describe("openProjectGraphDb schema version", () => {
  it("writes schema version 1 on a fresh graph.db", async () => {
    const dir = await tmpProject();
    const db = openProjectGraphDb(dir);
    try {
      const summary = queryGraphSummary(db, dir);
      expect(summary.schemaVersion).toBe(1);
      const row = db.prepare("SELECT value_json FROM graph_meta WHERE key = 'schema_version'").get() as {
        value_json: string;
      };
      expect(JSON.parse(row.value_json)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("throws when stored schema_version is newer than this build", async () => {
    const dir = await tmpProject();
    const first = openProjectGraphDb(dir);
    first.prepare("UPDATE graph_meta SET value_json = ? WHERE key = 'schema_version'").run(JSON.stringify(999));
    first.close();

    expect(() => openProjectGraphDb(dir)).toThrow(/schema version 999/i);
  });

  it("migrates an older stored schema_version up to 1", async () => {
    const dir = await tmpProject();
    const first = openProjectGraphDb(dir);
    first.prepare("UPDATE graph_meta SET value_json = ? WHERE key = 'schema_version'").run(JSON.stringify(0));
    first.close();

    const second = openProjectGraphDb(dir);
    try {
      expect(queryGraphSummary(second, dir).schemaVersion).toBe(1);
    } finally {
      second.close();
    }
  });
});

describe("openProjectGraphDb busy_timeout", () => {
  it("sets busy_timeout to 5000ms", async () => {
    const dir = await tmpProject();
    const db = openProjectGraphDb(dir);
    try {
      const timeout = db.pragma("busy_timeout", { simple: true }) as number;
      expect(timeout).toBe(5000);
    } finally {
      db.close();
    }
  });
});

describe("replaceInferredGraph user_locked nodes", () => {
  it("does not overwrite summary_en or state for user_locked nodes", async () => {
    const dir = await tmpProject();
    const db = openProjectGraphDb(dir);
    try {
      const node = sampleNode();
      replaceInferredGraph(db, [node], [], "2026-01-01T00:00:00.000Z");
      db.prepare("UPDATE nodes SET summary_en = ?, state = 'user_locked', updated_at = ? WHERE id = ?").run(
        "user-authored summary",
        "2026-01-02T00:00:00.000Z",
        node.id,
      );

      replaceInferredGraph(
        db,
        [sampleNode({ summaryEn: "scanner overwrite", state: "inferred", updatedAt: "2026-01-03T00:00:00.000Z" })],
        [],
        "2026-01-03T00:00:00.000Z",
      );

      const row = db
        .prepare("SELECT summary_en AS summaryEn, state FROM nodes WHERE id = ?")
        .get(node.id) as { summaryEn: string; state: string };
      expect(row.summaryEn).toBe("user-authored summary");
      expect(row.state).toBe("user_locked");
    } finally {
      db.close();
    }
  });
});
