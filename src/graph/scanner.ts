import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { GraphEdge, GraphNode, GraphEdgeKind, GraphNodeKind } from "./types.js";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".winnow",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  "target",
]);

const SOURCE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

function toPosixPath(input: string): string {
  return input.split(sep).join("/");
}

function makeNodeId(kind: GraphNodeKind, key: string): string {
  return `${kind.toLowerCase()}::${key}`;
}

function makeEdgeId(fromId: string, kind: GraphEdgeKind, toId: string): string {
  return `${fromId}::${kind}::${toId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function inferFileSummary(relPath: string): string {
  if (relPath.includes("/test") || relPath.includes(".test.") || relPath.includes(".spec.")) {
    return "Test file in project source tree.";
  }
  if (relPath.endsWith(".md")) {
    return "Documentation file.";
  }
  return "Project file captured by deterministic graph scan.";
}

type ExtractedFunction = {
  name: string;
  signature: string;
  body: string;
};

async function walkFiles(root: string, startDir: string, out: string[]): Promise<void> {
  const abs = join(root, startDir);
  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const name = String(ent.name);
    const rel = startDir ? join(startDir, name) : name;
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(name)) {
        continue;
      }
      await walkFiles(root, rel, out);
      continue;
    }
    if (!ent.isFile()) {
      continue;
    }
    out.push(rel);
  }
}

function extractDependencySpecifiers(content: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /import\s+[^'"]*from\s+["']([^"']+)["']/g,
    /import\s*["']([^"']+)["']/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[1]) {
        out.add(m[1]);
      }
    }
  }
  return [...out];
}

function resolveDependencyToRelFile(
  importerRel: string,
  specifier: string,
  sourceFileSet: Set<string>,
): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const importerDir = toPosixPath(importerRel).split("/").slice(0, -1).join("/");
  const base = toPosixPath(join(importerDir || ".", specifier));
  const candidates = [base, ...SOURCE_EXTS.map((ext) => `${base}${ext}`), ...SOURCE_EXTS.map((ext) => `${base}/index${ext}`)];
  for (const candRaw of candidates) {
    const normalized = toPosixPath(candRaw.replace(/^\.\//, ""));
    if (sourceFileSet.has(normalized)) {
      return normalized;
    }
  }
  return null;
}

function extractFunctions(content: string): ExtractedFunction[] {
  const out: ExtractedFunction[] = [];
  const seen = new Set<string>();
  const patterns = [
    {
      re: /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g,
      buildSig: (name: string, args: string) => `function ${name}(${args.trim()})`,
    },
    {
      re: /(?:export\s+)?const\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/g,
      buildSig: (name: string, args: string) => `const ${name} = (${args.trim()}) =>`,
    },
    {
      re: /(?:export\s+)?const\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?([A-Za-z_]\w*)\s*=>\s*\{/g,
      buildSig: (name: string, arg: string) => `const ${name} = ${arg.trim()} =>`,
    },
  ];

  for (const { re, buildSig } of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const name = m[1];
      if (!name || seen.has(name)) {
        continue;
      }
      const args = m[2] ?? "";
      const openBraceIdx = m.index + m[0].length - 1;
      let depth = 0;
      let end = -1;
      for (let i = openBraceIdx; i < content.length; i += 1) {
        const ch = content[i];
        if (ch === "{") depth += 1;
        if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const body = end > openBraceIdx ? content.slice(openBraceIdx + 1, end) : "";
      out.push({
        name,
        signature: buildSig(name, args),
        body,
      });
      seen.add(name);
    }
  }
  return out;
}

function extractCallTargets(body: string): string[] {
  const out = new Set<string>();
  const re = /\b([A-Za-z_]\w*)\s*\(/g;
  const reserved = new Set([
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "return",
    "new",
    "typeof",
    "void",
    "await",
  ]);
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const name = m[1];
    if (!name || reserved.has(name)) {
      continue;
    }
    out.add(name);
  }
  return [...out];
}

function inferDataOps(
  body: string,
): Array<{ kind: "reads" | "writes" | "emits"; entityKey: string; entityLabel: string; reason: string }> {
  const ops: Array<{ kind: "reads" | "writes" | "emits"; entityKey: string; entityLabel: string; reason: string }> = [];
  const add = (kind: "reads" | "writes" | "emits", key: string, label: string, reason: string) => {
    if (!ops.some((o) => o.kind === kind && o.entityKey === key)) {
      ops.push({ kind, entityKey: key, entityLabel: label, reason });
    }
  };
  if (/\bread(File|FileSync)\b|\breaddir\b|\bquery\w*\b|\bSELECT\b/i.test(body)) {
    add("reads", "filesystem_or_db", "Filesystem/Database", "Function likely reads from persistent sources.");
  }
  if (/\bwrite(File|FileSync)\b|\bappendFile\b|\bUPDATE\b|\bINSERT\b|\bDELETE\b/i.test(body)) {
    add("writes", "filesystem_or_db", "Filesystem/Database", "Function likely writes to persistent sources.");
  }
  if (/\bsendJson\b|\bres\.write\b|\bemit\b|\bpushStreamEvent\b|\bconsole\.(log|error|warn)\b/i.test(body)) {
    add("emits", "events_or_output", "Events/Output", "Function likely emits events/output.");
  }
  return ops;
}

export async function buildDeterministicProjectGraph(projectRoot: string): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
  generatedAt: string;
}> {
  const root = resolve(projectRoot);
  const generatedAt = nowIso();

  const relFilesRaw: string[] = [];
  await walkFiles(root, "", relFilesRaw);
  const relFiles = relFilesRaw.map((p) => toPosixPath(p));

  const sourceFiles = relFiles.filter((p) => SOURCE_EXTS.some((ext) => p.endsWith(ext)));
  const sourceSet = new Set(sourceFiles);
  const fileContentByRel = new Map<string, string>();

  const nodeMap = new Map<string, GraphNode>();
  const edgeMap = new Map<string, GraphEdge>();

  const addNode = (node: GraphNode): void => {
    nodeMap.set(node.id, node);
  };
  const addEdge = (edge: GraphEdge): void => {
    edgeMap.set(edge.id, edge);
  };

  const projectNodeId = makeNodeId("Project", root);
  addNode({
    id: projectNodeId,
    kind: "Project",
    name: root.split(sep).pop() || root,
    path: root,
    signature: null,
    summaryEn: "Project root node for deterministic dependency graph.",
    detailLevel: "L0",
    tagsJson: "[]",
    state: "inferred",
    confidence: 1.0,
    createdAt: generatedAt,
    updatedAt: generatedAt,
  });

  const moduleSet = new Set<string>();
  for (const rel of relFiles) {
    const dir = rel.includes("/") ? rel.split("/").slice(0, -1).join("/") : ".";
    moduleSet.add(dir || ".");
  }
  for (const moduleRel of moduleSet) {
    const moduleId = makeNodeId("Module", moduleRel);
    addNode({
      id: moduleId,
      kind: "Module",
      name: moduleRel === "." ? "(root)" : moduleRel.split("/").pop() || moduleRel,
      path: moduleRel === "." ? root : join(root, moduleRel),
      signature: null,
      summaryEn: "Directory/module node inferred from project tree.",
      detailLevel: "L1",
      tagsJson: "[]",
      state: "inferred",
      confidence: 1.0,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    });

    const parentRel = moduleRel === "." ? null : moduleRel.includes("/") ? moduleRel.split("/").slice(0, -1).join("/") : ".";
    const parentId = parentRel === null ? projectNodeId : makeNodeId("Module", parentRel || ".");
    addEdge({
      id: makeEdgeId(parentId, "contains", moduleId),
      fromId: parentId,
      toId: moduleId,
      kind: "contains",
      summaryEn: "Containment relation from project/module to module.",
      weight: 1,
      state: "inferred",
      confidence: 1.0,
      evidenceJson: "[]",
      createdAt: generatedAt,
      updatedAt: generatedAt,
    });
  }

  for (const rel of relFiles) {
    const fileId = makeNodeId("File", rel);
    const absPath = join(root, rel);
    addNode({
      id: fileId,
      kind: "File",
      name: rel.split("/").pop() || rel,
      path: absPath,
      signature: null,
      summaryEn: inferFileSummary(rel),
      detailLevel: "L2",
      tagsJson: "[]",
      state: "inferred",
      confidence: 1.0,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    });
    const moduleRel = rel.includes("/") ? rel.split("/").slice(0, -1).join("/") : ".";
    const moduleId = makeNodeId("Module", moduleRel || ".");
    addEdge({
      id: makeEdgeId(moduleId, "contains", fileId),
      fromId: moduleId,
      toId: fileId,
      kind: "contains",
      summaryEn: "Containment relation from module to file.",
      weight: 1,
      state: "inferred",
      confidence: 1.0,
      evidenceJson: "[]",
      createdAt: generatedAt,
      updatedAt: generatedAt,
    });
  }

  for (const rel of sourceFiles) {
    const abs = join(root, rel);
    let content = "";
    try {
      const info = await stat(abs);
      if (!info.isFile() || info.size > 1024 * 1024) {
        continue;
      }
      content = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    fileContentByRel.set(rel, content);
    const specs = extractDependencySpecifiers(content);
    const fromId = makeNodeId("File", rel);
    for (const spec of specs) {
      const depRel = resolveDependencyToRelFile(rel, spec, sourceSet);
      if (!depRel) {
        continue;
      }
      const toId = makeNodeId("File", depRel);
      addEdge({
        id: makeEdgeId(fromId, "depends_on", toId),
        fromId,
        toId,
        kind: "depends_on",
        summaryEn: `Static import dependency: ${spec}`,
        weight: 1,
        state: "inferred",
        confidence: 0.95,
        evidenceJson: JSON.stringify([{ type: "import_specifier", value: spec, file: rel }]),
        createdAt: generatedAt,
        updatedAt: generatedAt,
      });
    }
  }

  for (const rel of sourceFiles) {
    const content = fileContentByRel.get(rel);
    if (!content) {
      continue;
    }
    const funcs = extractFunctions(content);
    if (funcs.length === 0) {
      continue;
    }
    const fileId = makeNodeId("File", rel);
    const symbolIdByName = new Map<string, string>();
    for (const fn of funcs) {
      const symbolKey = `${rel}#${fn.name}`;
      const symbolId = makeNodeId("Symbol", symbolKey);
      symbolIdByName.set(fn.name, symbolId);
      addNode({
        id: symbolId,
        kind: "Symbol",
        name: fn.name,
        path: join(root, rel),
        signature: fn.signature,
        summaryEn: "Function symbol inferred by regex parser.",
        detailLevel: "L3",
        tagsJson: "[]",
        state: "inferred",
        confidence: 0.8,
        createdAt: generatedAt,
        updatedAt: generatedAt,
      });
      addEdge({
        id: makeEdgeId(fileId, "contains", symbolId),
        fromId: fileId,
        toId: symbolId,
        kind: "contains",
        summaryEn: "Containment relation from file to function symbol.",
        weight: 1,
        state: "inferred",
        confidence: 0.95,
        evidenceJson: "[]",
        createdAt: generatedAt,
        updatedAt: generatedAt,
      });
    }

    for (const fn of funcs) {
      const fromId = symbolIdByName.get(fn.name);
      if (!fromId) continue;
      for (const callee of extractCallTargets(fn.body)) {
        const toId = symbolIdByName.get(callee);
        if (!toId || toId === fromId) {
          continue;
        }
        addEdge({
          id: makeEdgeId(fromId, "calls", toId),
          fromId,
          toId,
          kind: "calls",
          summaryEn: `Function call inferred: ${fn.name} -> ${callee}`,
          weight: 1,
          state: "inferred",
          confidence: 0.7,
          evidenceJson: JSON.stringify([{ type: "callee", value: callee, file: rel }]),
          createdAt: generatedAt,
          updatedAt: generatedAt,
        });
      }

      for (const op of inferDataOps(fn.body)) {
        const entityId = makeNodeId("DataEntity", op.entityKey);
        if (!nodeMap.has(entityId)) {
          addNode({
            id: entityId,
            kind: "DataEntity",
            name: op.entityLabel,
            path: null,
            signature: null,
            summaryEn: "Cross-cutting data entity inferred from function behavior.",
            detailLevel: "L2",
            tagsJson: "[]",
            state: "inferred",
            confidence: 0.65,
            createdAt: generatedAt,
            updatedAt: generatedAt,
          });
        }
        addEdge({
          id: makeEdgeId(fromId, op.kind, entityId),
          fromId,
          toId: entityId,
          kind: op.kind,
          summaryEn: op.reason,
          weight: 1,
          state: "inferred",
          confidence: 0.65,
          evidenceJson: JSON.stringify([{ type: "behavioral_regex", file: rel }]),
          createdAt: generatedAt,
          updatedAt: generatedAt,
        });
      }
    }
  }

  return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()], generatedAt };
}

