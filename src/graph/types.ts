export type GraphDetailLevel = "L0" | "L1" | "L2" | "L3";

export type GraphNodeKind =
  | "Project"
  | "Domain"
  | "Module"
  | "File"
  | "Symbol"
  | "Workflow"
  | "Concept"
  | "DataEntity"
  | "ExternalSystem";

export type GraphEdgeKind =
  | "contains"
  | "depends_on"
  | "calls"
  | "reads"
  | "writes"
  | "emits"
  | "consumes"
  | "defines"
  | "implements"
  | "drives"
  | "uses_external"
  | "related_to";

export type GraphState = "inferred" | "user_locked" | "system_verified" | "deprecated";

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  name: string;
  path: string | null;
  signature: string | null;
  summaryEn: string | null;
  detailLevel: GraphDetailLevel;
  tagsJson: string;
  state: GraphState;
  confidence: number;
  createdAt: string;
  updatedAt: string;
};

export type GraphEdge = {
  id: string;
  fromId: string;
  toId: string;
  kind: GraphEdgeKind;
  summaryEn: string | null;
  weight: number;
  state: GraphState;
  confidence: number;
  evidenceJson: string;
  createdAt: string;
  updatedAt: string;
};

export type GraphSummary = {
  projectRoot: string;
  schemaVersion: number;
  nodesTotal: number;
  edgesTotal: number;
  nodesByKind: { kind: string; count: number }[];
  edgesByKind: { kind: string; count: number }[];
  updatedAt: string | null;
};

