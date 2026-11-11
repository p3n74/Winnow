import { describe, expect, it } from "vitest";
import { augmentWithSemanticInference } from "../src/graph/inference.js";
import type { GraphEdge, GraphNode } from "../src/graph/types.js";

const NOW = "2026-01-01T00:00:00.000Z";

function node(overrides: Partial<GraphNode> & Pick<GraphNode, "id" | "kind" | "name">): GraphNode {
  return {
    path: null,
    signature: null,
    summaryEn: null,
    descriptionEn: null,
    detailLevel: "L2",
    tagsJson: "[]",
    state: "inferred",
    confidence: 0.5,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function edge(overrides: Partial<GraphEdge> & Pick<GraphEdge, "id" | "fromId" | "toId" | "kind">): GraphEdge {
  return {
    summaryEn: null,
    weight: 1,
    state: "inferred",
    confidence: 0.5,
    evidenceJson: "[]",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("augmentWithSemanticInference", () => {
  it("infers a concept from pkg/api files and skips hardcoded Winnow concepts", () => {
    const files = [
      node({ id: "file::a", kind: "File", name: "a.ts", path: "pkg/api/a.ts" }),
      node({ id: "file::b", kind: "File", name: "b.ts", path: "pkg/api/b.ts" }),
    ];

    const { nodes, edges } = augmentWithSemanticInference(files, [], NOW);
    const concepts = nodes.filter((n) => n.kind === "Concept");

    expect(concepts).toHaveLength(1);
    expect(concepts[0]).toMatchObject({
      id: "concept::pkg_api",
      name: "Api",
      kind: "Concept",
      path: null,
      signature: null,
      detailLevel: "L1",
      tagsJson: '["ai_inferred","concept"]',
      state: "inferred",
      confidence: 0.62,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(concepts[0]?.summaryEn).toMatch(/directory placement/i);
    expect(concepts[0]?.summaryEn).toContain("2");
    expect(concepts[0]?.descriptionEn).toMatch(/directory placement/i);
    expect(concepts[0]?.descriptionEn).toContain("2");

    const related = edges.filter((e) => e.kind === "related_to");
    expect(related).toHaveLength(2);
    expect(related.map((e) => e.fromId).sort()).toEqual(["file::a", "file::b"]);
    expect(related.every((e) => e.toId === "concept::pkg_api")).toBe(true);
    expect(related.every((e) => e.evidenceJson === '[{"type":"path_heuristic"}]')).toBe(true);
    expect(related.every((e) => e.confidence === 0.72 && e.weight === 1 && e.state === "inferred")).toBe(true);

    const names = nodes.map((n) => n.name);
    expect(names).not.toContain("CLI Orchestration");
    expect(names).not.toContain("Data Persistence");
    expect(names).not.toContain("Cursor Integration");
    const ids = nodes.map((n) => n.id);
    expect(ids).not.toContain("concept::cli_orchestration");
    expect(ids).not.toContain("concept::data_persistence");
    expect(ids).not.toContain("concept::cursor_integration");
  });

  it("does not create a concept for a directory with fewer than 2 files", () => {
    const files = [
      node({ id: "file::a", kind: "File", name: "a.ts", path: "pkg/api/a.ts" }),
      node({ id: "file::root", kind: "File", name: "README.md", path: "README.md" }),
    ];

    const { nodes, edges } = augmentWithSemanticInference(files, [], NOW);

    expect(nodes.filter((n) => n.kind === "Concept")).toHaveLength(0);
    expect(edges.filter((e) => e.kind === "related_to")).toHaveLength(0);
    expect(nodes).toHaveLength(files.length);
  });

  it("clusters same-verb symbols by directory into one workflow", () => {
    const symbols = [
      node({ id: "sym::user", kind: "Symbol", name: "createUser", path: "src/graph/service.ts" }),
      node({ id: "sym::session", kind: "Symbol", name: "createSession", path: "src/graph/service.ts" }),
      node({ id: "sym::cli", kind: "Symbol", name: "createUser", path: "src/cli/ui.ts" }),
      node({ id: "sym::creating", kind: "Symbol", name: "creatingUser", path: "src/graph/service.ts" }),
      node({ id: "sym::root", kind: "Symbol", name: "runTask", path: "index.ts" }),
    ];

    const { nodes, edges } = augmentWithSemanticInference(symbols, [], NOW);
    const workflows = nodes.filter((n) => n.kind === "Workflow");

    expect(workflows).toHaveLength(3);

    const graph = workflows.find((w) => w.id === "workflow::src_graph__create");
    const cli = workflows.find((w) => w.id === "workflow::src_cli__create");
    const root = workflows.find((w) => w.id === "workflow::root__run");

    expect(graph).toMatchObject({
      name: "Create (graph)",
      kind: "Workflow",
      path: null,
      signature: null,
      detailLevel: "L1",
      tagsJson: '["ai_inferred","workflow"]',
      state: "inferred",
      confidence: 0.7,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(graph?.summaryEn).toMatch(/create/i);
    expect(graph?.summaryEn).toContain("src/graph");
    expect(graph?.descriptionEn).toContain("2");
    expect(cli).toMatchObject({ name: "Create (cli)" });
    expect(root).toMatchObject({ name: "Run" });

    const drives = edges.filter((e) => e.kind === "drives");
    const graphDrives = drives.filter((e) => e.fromId === "workflow::src_graph__create");
    expect(graphDrives.map((e) => e.toId).sort()).toEqual(["sym::session", "sym::user"]);
    expect(graphDrives.map((e) => e.id).sort()).toEqual([
      "workflow::src_graph__create::drives::sym::session",
      "workflow::src_graph__create::drives::sym::user",
    ]);
    expect(graphDrives.every((e) => e.evidenceJson === '[{"type":"name_heuristic"}]')).toBe(true);
    expect(graphDrives.every((e) => e.summaryEn?.includes("drives") && e.confidence === 0.7)).toBe(true);
    expect(drives.filter((e) => e.fromId === "workflow::src_cli__create").map((e) => e.toId)).toEqual(["sym::cli"]);
    expect(drives.some((e) => e.toId === "sym::creating")).toBe(false);
  });

  it("links a directory concept to the workflows inside it", () => {
    const base = [
      node({ id: "file::a", kind: "File", name: "service.ts", path: "src/graph/service.ts" }),
      node({ id: "file::b", kind: "File", name: "store.ts", path: "src/graph/store.ts" }),
      node({ id: "sym::user", kind: "Symbol", name: "createUser", path: "src/graph/service.ts" }),
      node({ id: "sym::other", kind: "Symbol", name: "createUser", path: "src/cli/ui.ts" }),
    ];

    const { edges } = augmentWithSemanticInference(base, [], NOW);
    const link = edges.find(
      (e) => e.fromId === "concept::src_graph" && e.toId === "workflow::src_graph__create" && e.kind === "related_to",
    );

    expect(link).toBeTruthy();
    expect(link?.evidenceJson).toBe('[{"type":"path_heuristic"}]');
    expect(
      edges.some((e) => e.fromId === "concept::src_graph" && e.toId === "workflow::src_cli__create"),
    ).toBe(false);
  });

  it("does not attach test-like symbols to a workflow", () => {
    const symbols = [
      node({ id: "sym::real", kind: "Symbol", name: "createUser", path: "src/graph/service.ts" }),
      node({ id: "sym::test", kind: "Symbol", name: "createUser", path: "src/graph/service.test.ts" }),
      node({ id: "sym::spec", kind: "Symbol", name: "createUser", path: "src/graph/service.spec.ts" }),
      node({ id: "sym::dunder", kind: "Symbol", name: "createUser", path: "src/__tests__/service.ts" }),
      node({ id: "sym::tests", kind: "Symbol", name: "createUser", path: "tests/service.ts" }),
      node({ id: "sym::mock", kind: "Symbol", name: "createUser", path: "src\\mocks\\service.ts" }),
      node({ id: "sym::fixture", kind: "Symbol", name: "createUser", path: "src/fixtures/service.ts" }),
    ];

    const { nodes, edges } = augmentWithSemanticInference(symbols, [], NOW);
    const drives = edges.filter((e) => e.kind === "drives");

    expect(nodes.filter((n) => n.kind === "Workflow")).toHaveLength(1);
    expect(drives.map((e) => e.toId)).toEqual(["sym::real"]);
  });

  it("passes base nodes and edges through without mutating the inputs", () => {
    const baseNodes = [
      node({ id: "file::a", kind: "File", name: "a.ts", path: "pkg/api/a.ts" }),
      node({ id: "file::b", kind: "File", name: "b.ts", path: "pkg/api/b.ts" }),
      node({ id: "sym::user", kind: "Symbol", name: "createUser", path: "src/graph/service.ts" }),
    ];
    const baseEdges = [
      edge({ id: "edge::contains", fromId: "file::a", toId: "sym::user", kind: "contains" }),
    ];
    const nodeSnapshot = baseNodes.map((n) => ({ ...n }));
    const edgeSnapshot = baseEdges.map((e) => ({ ...e }));

    const { nodes, edges } = augmentWithSemanticInference(baseNodes, baseEdges, NOW);

    expect(baseNodes).toEqual(nodeSnapshot);
    expect(baseEdges).toEqual(edgeSnapshot);
    expect(baseNodes).toHaveLength(3);
    expect(baseEdges).toHaveLength(1);
    for (const base of baseNodes) expect(nodes).toContainEqual(base);
    for (const base of baseEdges) expect(edges).toContainEqual(base);
    expect(nodes.length).toBeGreaterThan(baseNodes.length);
    expect(edges.length).toBeGreaterThan(baseEdges.length);
  });

  it("keeps the 80 largest workflow groups, then breaks ties by label", () => {
    const symbols: GraphNode[] = [];
    for (let i = 0; i <= 80; i += 1) {
      const dir = `area/g${String(i).padStart(2, "0")}`;
      symbols.push(
        node({
          id: `sym::${i}`,
          kind: "Symbol",
          name: "createItem",
          path: `${dir}/file.ts`,
        }),
      );
    }
    symbols.push(
      node({
        id: "sym::g80-extra",
        kind: "Symbol",
        name: "createOther",
        path: "area/g80/other.ts",
      }),
    );

    const { nodes, edges } = augmentWithSemanticInference(symbols, [], NOW);
    const workflows = nodes.filter((n) => n.kind === "Workflow");
    const ids = new Set(workflows.map((w) => w.id));

    expect(workflows).toHaveLength(80);
    expect(ids.has("workflow::area_g80__create")).toBe(true);
    expect(ids.has("workflow::area_g00__create")).toBe(true);
    expect(ids.has("workflow::area_g79__create")).toBe(false);
    expect(edges.filter((e) => e.fromId === "workflow::area_g80__create")).toHaveLength(2);
    expect(symbols.every((symbol) => nodes.some((n) => n.id === symbol.id))).toBe(true);
  });

  it("disambiguates concept names that share a last segment and prefers non-test files", () => {
    const files = [
      node({ id: "file::src-a", kind: "File", name: "a.ts", path: "src/foo/a.ts" }),
      node({ id: "file::src-b", kind: "File", name: "b.ts", path: "src/foo/b.ts" }),
      node({ id: "file::pkg-a", kind: "File", name: "c.ts", path: "pkg/foo/c.ts" }),
      node({ id: "file::pkg-b", kind: "File", name: "d.ts", path: "pkg/foo/d.ts" }),
      node({ id: "file::pkg-c", kind: "File", name: "e.ts", path: "pkg/foo/e.ts" }),
    ];
    for (let i = 0; i < 40; i += 1) {
      files.push(
        node({
          id: `file::test-${i}`,
          kind: "File",
          name: `t${i}.test.ts`,
          path: `pkg/foo/t${i}.test.ts`,
        }),
      );
    }

    const { nodes, edges } = augmentWithSemanticInference(files, [], NOW);
    const concepts = nodes.filter((n) => n.kind === "Concept");
    const byId = new Map(concepts.map((concept) => [concept.id, concept]));

    expect(byId.get("concept::src_foo")).toMatchObject({ name: "Foo / Src", confidence: 0.62 });
    expect(byId.get("concept::pkg_foo")).toMatchObject({ name: "Foo / Pkg", confidence: 0.75 });

    const pkgEdges = edges.filter((e) => e.toId === "concept::pkg_foo");
    expect(pkgEdges).toHaveLength(40);
    expect(pkgEdges.map((e) => e.fromId)).toEqual(
      expect.arrayContaining(["file::pkg-a", "file::pkg-b", "file::pkg-c"]),
    );
    expect(pkgEdges.some((e) => e.fromId === "file::test-39")).toBe(false);
  });
});
