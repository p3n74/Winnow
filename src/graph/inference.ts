import type { GraphEdge, GraphNode } from "./types.js";

function workflowKeyFromSymbol(name: string): string | null {
  const lower = name.toLowerCase();
  const prefixes = ["start", "run", "build", "refresh", "load", "save", "apply", "create", "update", "delete"];
  if (!prefixes.some((p) => lower.startsWith(p))) {
    return null;
  }
  return lower;
}

export function augmentWithSemanticInference(
  baseNodes: GraphNode[],
  baseEdges: GraphEdge[],
  generatedAt: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeMap = new Map(baseNodes.map((n) => [n.id, n]));
  const edgeMap = new Map(baseEdges.map((e) => [e.id, e]));

  const addNode = (n: GraphNode) => {
    if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
  };
  const addEdge = (e: GraphEdge) => {
    if (!edgeMap.has(e.id)) edgeMap.set(e.id, e);
  };

  for (const n of baseNodes) {
    if (n.kind !== "Symbol") continue;
    const key = workflowKeyFromSymbol(n.name);
    if (!key) continue;
    const wfId = `workflow::${key}`;
    addNode({
      id: wfId,
      kind: "Workflow",
      name: n.name,
      path: null,
      signature: null,
      summaryEn: "Workflow node inferred from high-action symbol naming.",
      detailLevel: "L1",
      tagsJson: '["ai_inferred","workflow"]',
      state: "inferred",
      confidence: 0.7,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    });
    addEdge({
      id: `${wfId}::drives::${n.id}`,
      fromId: wfId,
      toId: n.id,
      kind: "drives",
      summaryEn: "Workflow likely drives this symbol/function.",
      weight: 1,
      state: "inferred",
      confidence: 0.7,
      evidenceJson: '[{"type":"name_heuristic"}]',
      createdAt: generatedAt,
      updatedAt: generatedAt,
    });
  }

  const conceptDefs = [
    { key: "cli_orchestration", label: "CLI Orchestration", includes: ["/src/cli/"] },
    { key: "data_persistence", label: "Data Persistence", includes: ["/src/data/"] },
    { key: "cursor_integration", label: "Cursor Integration", includes: ["/src/cursor/"] },
  ];

  for (const def of conceptDefs) {
    const conceptId = `concept::${def.key}`;
    addNode({
      id: conceptId,
      kind: "Concept",
      name: def.label,
      path: null,
      signature: null,
      summaryEn: "Concept node inferred from project structure.",
      detailLevel: "L1",
      tagsJson: '["ai_inferred","concept"]',
      state: "inferred",
      confidence: 0.75,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    });
    for (const n of baseNodes) {
      if (n.kind !== "File" || !n.path) continue;
      if (!def.includes.some((p) => n.path?.includes(p))) continue;
      addEdge({
        id: `${n.id}::related_to::${conceptId}`,
        fromId: n.id,
        toId: conceptId,
        kind: "related_to",
        summaryEn: "File is semantically related to this inferred concept.",
        weight: 1,
        state: "inferred",
        confidence: 0.72,
        evidenceJson: '[{"type":"path_heuristic"}]',
        createdAt: generatedAt,
        updatedAt: generatedAt,
      });
    }
  }

  return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()] };
}

