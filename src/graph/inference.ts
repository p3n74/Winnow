import type { GraphEdge, GraphNode } from "./types.js";

const ACTION_PREFIXES = new Set([
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
]);

const GROUPED_ROOTS = new Set(["src", "app", "lib", "packages", "pkg"]);

const MAX_WORKFLOWS = 80;
const MAX_CONCEPTS = 24;
const MAX_CONCEPT_EDGES = 40;

function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

function isTestLikePath(path: string | null): boolean {
  if (!path) return false;
  const posix = toPosix(path);
  return (
    posix.includes("/__tests__/") ||
    posix.startsWith("__tests__/") ||
    /(^|\/)tests?\//.test(posix) ||
    posix.includes(".test.") ||
    posix.includes(".spec.") ||
    /(^|\/)mocks?\//.test(posix) ||
    /(^|\/)fixtures?\//.test(posix)
  );
}

function titleCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function sanitizeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function firstToken(name: string): string | null {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const parts = spaced.split(/[\s_-]+/).filter((part) => part.length > 0);
  const token = parts[0];
  return token ? token.toLowerCase() : null;
}

function parentDirectory(path: string | null): string {
  if (!path) return "root";
  const posix = toPosix(path);
  const slash = posix.lastIndexOf("/");
  if (slash <= 0) return "root";
  return posix.slice(0, slash);
}

function workflowLabel(prefix: string, directory: string): string {
  const titled = titleCase(prefix);
  if (directory === "root") return titled;
  const segment = directory.slice(directory.lastIndexOf("/") + 1);
  return `${titled} (${segment})`;
}

function conceptKeyFromParts(parts: string[]): string | null {
  const head = parts[0];
  const second = parts[1];
  if (!head) return null;
  if (GROUPED_ROOTS.has(head) && second) return `${head}/${second}`;
  return head;
}

function conceptKeyForFile(path: string): string | null {
  const parts = toPosix(path).split("/").filter((part) => part.length > 0);
  if (parts.length < 2) return null;
  return conceptKeyFromParts(parts.slice(0, -1));
}

function conceptKeyForDirectory(directory: string): string | null {
  if (!directory || directory === "root") return null;
  const parts = toPosix(directory).split("/").filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  return conceptKeyFromParts(parts);
}

type WorkflowGroup = {
  key: string;
  directory: string;
  prefix: string;
  label: string;
  symbols: GraphNode[];
};

function collectWorkflows(baseNodes: GraphNode[]): WorkflowGroup[] {
  const groups = new Map<string, WorkflowGroup>();
  for (const node of baseNodes) {
    if (node.kind !== "Symbol" || isTestLikePath(node.path)) continue;
    const prefix = firstToken(node.name);
    if (!prefix || !ACTION_PREFIXES.has(prefix)) continue;
    const directory = parentDirectory(node.path);
    const key = `${directory}::${prefix}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, directory, prefix, label: workflowLabel(prefix, directory), symbols: [] };
      groups.set(key, group);
    }
    group.symbols.push(node);
  }

  return [...groups.values()]
    .sort((a, b) => {
      if (b.symbols.length !== a.symbols.length) return b.symbols.length - a.symbols.length;
      if (a.label !== b.label) return a.label < b.label ? -1 : 1;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    })
    .slice(0, MAX_WORKFLOWS);
}

type ConceptGroup = {
  key: string;
  files: GraphNode[];
};

function collectConcepts(baseNodes: GraphNode[]): ConceptGroup[] {
  const groups = new Map<string, ConceptGroup>();
  for (const node of baseNodes) {
    if (node.kind !== "File" || !node.path) continue;
    const key = conceptKeyForFile(node.path);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = { key, files: [] };
      groups.set(key, group);
    }
    group.files.push(node);
  }

  return [...groups.values()]
    .filter((group) => group.files.length >= 2)
    .sort((a, b) => {
      if (b.files.length !== a.files.length) return b.files.length - a.files.length;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    })
    .slice(0, MAX_CONCEPTS);
}

function lastSegment(key: string): string {
  const slash = key.lastIndexOf("/");
  return slash === -1 ? key : key.slice(slash + 1);
}

function conceptName(key: string, sharedLast: ReadonlySet<string>): string {
  const last = lastSegment(key);
  if (!sharedLast.has(last)) return titleCase(last);
  const slash = key.lastIndexOf("/");
  if (slash === -1) return titleCase(last);
  const parent = key.slice(0, slash);
  const parentSegment = parent.slice(parent.lastIndexOf("/") + 1);
  return `${titleCase(last)} / ${titleCase(parentSegment)}`;
}

function preferConceptFiles(files: GraphNode[]): GraphNode[] {
  return files
    .map((file, index) => ({ file, index, test: isTestLikePath(file.path) }))
    .sort((a, b) => {
      if (a.test !== b.test) return a.test ? 1 : -1;
      return a.index - b.index;
    })
    .slice(0, MAX_CONCEPT_EDGES)
    .map((entry) => entry.file);
}

export function augmentWithSemanticInference(
  baseNodes: GraphNode[],
  baseEdges: GraphEdge[],
  generatedAt: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = baseNodes.slice();
  const edges = baseEdges.slice();
  const nodeIds = new Set(baseNodes.map((node) => node.id));
  const edgeIds = new Set(baseEdges.map((edge) => edge.id));

  const addNode = (node: GraphNode): boolean => {
    if (nodeIds.has(node.id)) return false;
    nodeIds.add(node.id);
    nodes.push(node);
    return true;
  };
  const addEdge = (edge: GraphEdge): boolean => {
    if (edgeIds.has(edge.id)) return false;
    edgeIds.add(edge.id);
    edges.push(edge);
    return true;
  };

  for (const group of collectWorkflows(baseNodes)) {
    const id = `workflow::${sanitizeKey(group.key)}`;
    const dirPhrase = group.directory === "root" ? "the project root" : group.directory;
    const added = addNode({
      id,
      kind: "Workflow",
      name: group.label,
      path: null,
      signature: null,
      summaryEn: `Groups ${group.prefix} symbols in ${dirPhrase}.`,
      descriptionEn: `Groups ${group.symbols.length} symbols that share the ${group.prefix} action in ${dirPhrase}.`,
      detailLevel: "L1",
      tagsJson: '["ai_inferred","workflow"]',
      state: "inferred",
      confidence: 0.7,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    });
    if (!added) continue;
    for (const symbol of group.symbols) {
      addEdge({
        id: `${id}::drives::${symbol.id}`,
        fromId: id,
        toId: symbol.id,
        kind: "drives",
        summaryEn: `Workflow drives ${symbol.name}.`,
        weight: 1,
        state: "inferred",
        confidence: 0.7,
        evidenceJson: '[{"type":"name_heuristic"}]',
        createdAt: generatedAt,
        updatedAt: generatedAt,
      });
    }
  }

  const conceptGroups = collectConcepts(baseNodes)
    .map((group) => ({ group, chosen: preferConceptFiles(group.files) }))
    .filter((entry) => entry.chosen.length > 0);

  const lastCounts = new Map<string, number>();
  for (const entry of conceptGroups) {
    const last = lastSegment(entry.group.key);
    lastCounts.set(last, (lastCounts.get(last) ?? 0) + 1);
  }
  const sharedLast = new Set(
    [...lastCounts.entries()].filter(([, count]) => count > 1).map(([last]) => last),
  );

  for (const { group, chosen } of conceptGroups) {
    const id = `concept::${sanitizeKey(group.key)}`;
    const fileCount = group.files.length;
    const added = addNode({
      id,
      kind: "Concept",
      name: conceptName(group.key, sharedLast),
      path: null,
      signature: null,
      summaryEn: `Concept inferred from directory placement (${fileCount} files).`,
      descriptionEn: `Inferred from directory placement of ${fileCount} files under ${group.key}.`,
      detailLevel: "L1",
      tagsJson: '["ai_inferred","concept"]',
      state: "inferred",
      confidence: fileCount >= 3 ? 0.75 : 0.62,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    });
    if (!added) continue;
    let linked = 0;
    for (const file of chosen) {
      const didLink = addEdge({
        id: `${file.id}::related_to::${id}`,
        fromId: file.id,
        toId: id,
        kind: "related_to",
        summaryEn: "File is related to a concept inferred from directory placement.",
        weight: 1,
        state: "inferred",
        confidence: 0.72,
        evidenceJson: '[{"type":"path_heuristic"}]',
        createdAt: generatedAt,
        updatedAt: generatedAt,
      });
      if (didLink) linked += 1;
    }
    if (linked === 0) {
      const index = nodes.findIndex((node) => node.id === id);
      if (index !== -1) nodes.splice(index, 1);
      nodeIds.delete(id);
    }
  }

  // Capabilities only become connected in the business map when a concept
  // points at a workflow in the same directory. File→concept edges do not,
  // because files are not business nodes.
  for (const group of collectWorkflows(baseNodes)) {
    const workflowId = `workflow::${sanitizeKey(group.key)}`;
    if (!nodeIds.has(workflowId)) continue;
    const conceptKey = conceptKeyForDirectory(group.directory);
    if (!conceptKey) continue;
    const conceptId = `concept::${sanitizeKey(conceptKey)}`;
    if (!nodeIds.has(conceptId)) continue;
    addEdge({
      id: `${conceptId}::related_to::${workflowId}`,
      fromId: conceptId,
      toId: workflowId,
      kind: "related_to",
      summaryEn: "Concept covers workflows inferred in this directory.",
      weight: 1,
      state: "inferred",
      confidence: 0.72,
      evidenceJson: '[{"type":"path_heuristic"}]',
      createdAt: generatedAt,
      updatedAt: generatedAt,
    });
  }

  return { nodes, edges };
}
