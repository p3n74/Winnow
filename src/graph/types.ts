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
  descriptionEn: string | null;
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

export type BusinessLogicNodeKind =
  | "BusinessGoal"
  | "BusinessCapability"
  | "BusinessProcess"
  | "BusinessStep"
  | "DataObject"
  | "ExternalActor";

export type BusinessLogicEdgeKind =
  | "enables"
  | "achieves"
  | "triggers"
  | "flows_to"
  | "reads"
  | "writes"
  | "emits"
  | "interacts_with";

export type BusinessLogicNode = {
  id: string;
  kind: BusinessLogicNodeKind;
  name: string;
  summaryEn: string | null;
  descriptionEn: string | null;
  confidence: number;
  sourceNodeIds: string[];
};

export type BusinessLogicEdge = {
  id: string;
  fromId: string;
  toId: string;
  kind: BusinessLogicEdgeKind;
  summaryEn: string | null;
  confidence: number;
  sourceEdgeIds: string[];
};

export type BusinessLogicGraph = {
  projectRoot: string;
  generatedAt: string;
  nodes: BusinessLogicNode[];
  edges: BusinessLogicEdge[];
  overview: {
    projectSummary: string;
    keyCapabilities: string[];
    keyGoals: string[];
    keyDataObjects: string[];
  };
  heuristicIndex: {
    conceptToFiles: Array<{ concept: string; files: string[] }>;
    workflowToSymbols: Array<{ workflow: string; symbols: string[] }>;
    fileHints: Array<{ file: string; symbols: string[] }>;
    lookupHints: string[];
  };
  flowchart: {
    startNodeIds: string[];
    topologicalHintIds: string[];
  };
};

