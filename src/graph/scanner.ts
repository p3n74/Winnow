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

function inferFileDescription(relPath: string, functionCount: number, dependencyCount: number): string {
  if (relPath.includes("/test") || relPath.includes(".test.") || relPath.includes(".spec.")) {
    return `Test-oriented file with ${functionCount} detected function(s) and ${dependencyCount} internal dependency link(s).`;
  }
  if (relPath.endsWith(".md")) {
    return "Documentation file used for project guidance and reference.";
  }
  return `Source file with ${functionCount} detected function(s) and ${dependencyCount} internal dependency link(s).`;
}

function summarizeSymbol(name: string, body: string): { summary: string; description: string } {
  const lower = name.toLowerCase();
  const hasIo = /\bread(File|FileSync)\b|\bwrite(File|FileSync)\b|\bquery\w*\b|\bfetch\(/i.test(body);
  const hasEvents = /\bemit\b|\bsendJson\b|\bres\.write\b|\bconsole\.(log|warn|error)\b/i.test(body);
  if (/^(create|update|delete|save|apply)/.test(lower)) {
    return {
      summary: "Mutating action function for project workflow.",
      description: "Likely performs state-changing behavior in a business or data flow.",
    };
  }
  if (/^(load|read|fetch|get|list)/.test(lower)) {
    return {
      summary: "Read-oriented function for lookup or retrieval.",
      description: "Likely gathers data used by downstream workflow steps.",
    };
  }
  if (/^(run|start|build|process|handle)/.test(lower)) {
    return {
      summary: "Orchestration function coordinating multiple actions.",
      description: "Likely acts as an execution entrypoint or flow coordinator.",
    };
  }
  if (hasIo || hasEvents) {
    return {
      summary: "Operational function interacting with IO or events.",
      description: "Contains side-effect patterns such as persistence, network operations, or emitted output.",
    };
  }
  return {
    summary: "Function symbol inferred by parser.",
    description: "General-purpose function extracted during project scan.",
  };
}

type ExtractedFunction = {
  name: string;
  signature: string;
  body: string;
};

type ImportedBinding = {
  localName: string;
  importedName: string;
  specifier: string;
};

type SymbolRecord = {
  id: string;
  name: string;
  fileRel: string;
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

function extractImportedBindings(content: string): ImportedBinding[] {
  const out: ImportedBinding[] = [];

  // import { a, b as c } from "x"
  const namedRe = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = namedRe.exec(content)) !== null) {
    const rawNames = (m[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const specifier = m[2] ?? "";
    for (const raw of rawNames) {
      const aliasMatch = raw.match(/^([A-Za-z_]\w*)\s+as\s+([A-Za-z_]\w*)$/);
      if (aliasMatch) {
        out.push({ importedName: aliasMatch[1], localName: aliasMatch[2], specifier });
      } else if (/^[A-Za-z_]\w*$/.test(raw)) {
        out.push({ importedName: raw, localName: raw, specifier });
      }
    }
  }

  // import Foo from "x"
  const defaultRe = /import\s+([A-Za-z_]\w*)\s+from\s+["']([^"']+)["']/g;
  while ((m = defaultRe.exec(content)) !== null) {
    out.push({ importedName: "default", localName: m[1], specifier: m[2] ?? "" });
  }

  // import Foo, { bar as baz } from "x"
  const mixedRe = /import\s+([A-Za-z_]\w*)\s*,\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  while ((m = mixedRe.exec(content)) !== null) {
    out.push({ importedName: "default", localName: m[1], specifier: m[3] ?? "" });
    const rawNames = (m[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    for (const raw of rawNames) {
      const aliasMatch = raw.match(/^([A-Za-z_]\w*)\s+as\s+([A-Za-z_]\w*)$/);
      if (aliasMatch) {
        out.push({ importedName: aliasMatch[1], localName: aliasMatch[2], specifier: m[3] ?? "" });
      } else if (/^[A-Za-z_]\w*$/.test(raw)) {
        out.push({ importedName: raw, localName: raw, specifier: m[3] ?? "" });
      }
    }
  }

  return out;
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

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dependsOnReturnValue(body: string, callee: string): boolean {
  const c = escapeRegExp(callee);
  const patterns = [
    new RegExp(`\\b(?:const|let|var)\\s+[A-Za-z_]\\w*\\s*=\\s*(?:await\\s+)?${c}\\s*\\(`),
    new RegExp(`\\breturn\\s+(?:await\\s+)?${c}\\s*\\(`),
    new RegExp(`\\bif\\s*\\(\\s*(?:await\\s+)?${c}\\s*\\(`),
    new RegExp(`\\b[A-Za-z_]\\w*\\s*=\\s*(?:await\\s+)?${c}\\s*\\(`),
  ];
  return patterns.some((re) => re.test(body));
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
  const importedBindingsByFile = new Map<string, ImportedBinding[]>();
  const importCountByRel = new Map<string, number>();

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
    descriptionEn: "Top-level node representing the currently indexed project workspace.",
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
      descriptionEn: "Represents a directory grouping related files in the source tree.",
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
      descriptionEn: inferFileDescription(rel, 0, 0),
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
    importedBindingsByFile.set(rel, extractImportedBindings(content));
    const specs = extractDependencySpecifiers(content);
    importCountByRel.set(rel, specs.length);
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

  const symbolRecords: SymbolRecord[] = [];
  const symbolsByFile = new Map<string, SymbolRecord[]>();
  const symbolsByName = new Map<string, SymbolRecord[]>();

  for (const rel of sourceFiles) {
    const content = fileContentByRel.get(rel);
    if (!content) {
      continue;
    }
    const funcs = extractFunctions(content);
    const fileId = makeNodeId("File", rel);
    const fileNode = nodeMap.get(fileId);
    if (fileNode) {
      fileNode.summaryEn =
        funcs.length > 0
          ? `Source file with ${funcs.length} function symbol(s) and ${importCountByRel.get(rel) ?? 0} internal dependency reference(s).`
          : inferFileSummary(rel);
      fileNode.descriptionEn = inferFileDescription(rel, funcs.length, importCountByRel.get(rel) ?? 0);
      fileNode.updatedAt = generatedAt;
      nodeMap.set(fileId, fileNode);
    }
    if (funcs.length === 0) {
      continue;
    }
    for (const fn of funcs) {
      const symbolKey = `${rel}#${fn.name}`;
      const symbolId = makeNodeId("Symbol", symbolKey);
      addNode({
        id: symbolId,
        kind: "Symbol",
        name: fn.name,
        path: join(root, rel),
        signature: fn.signature,
        summaryEn: summarizeSymbol(fn.name, fn.body).summary,
        descriptionEn: summarizeSymbol(fn.name, fn.body).description,
        detailLevel: "L3",
        tagsJson: "[]",
        state: "inferred",
        confidence: 0.8,
        createdAt: generatedAt,
        updatedAt: generatedAt,
      });
      const rec: SymbolRecord = {
        id: symbolId,
        name: fn.name,
        fileRel: rel,
        signature: fn.signature,
        body: fn.body,
      };
      symbolRecords.push(rec);
      const byFile = symbolsByFile.get(rel) ?? [];
      byFile.push(rec);
      symbolsByFile.set(rel, byFile);
      const byName = symbolsByName.get(fn.name) ?? [];
      byName.push(rec);
      symbolsByName.set(fn.name, byName);
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
  }

  for (const rec of symbolRecords) {
    const fromId = rec.id;
    const callTargets = extractCallTargets(rec.body);
    const importedBindings = importedBindingsByFile.get(rec.fileRel) ?? [];
    const importedByLocal = new Map(importedBindings.map((b) => [b.localName, b]));
    const fileLocalSymbols = symbolsByFile.get(rec.fileRel) ?? [];

    for (const callee of callTargets) {
      const candidates: Array<{ target: SymbolRecord; confidence: number; evidenceType: string }> = [];

      const imported = importedByLocal.get(callee);
      if (imported) {
        const depRel = resolveDependencyToRelFile(rec.fileRel, imported.specifier, sourceSet);
        if (depRel) {
          const depSymbols = symbolsByFile.get(depRel) ?? [];
          const named = depSymbols.filter((s) => s.name === imported.importedName || s.name === callee);
          if (named.length > 0) {
            for (const target of named) candidates.push({ target, confidence: 0.9, evidenceType: "import_named" });
          } else if (depSymbols.length === 1) {
            candidates.push({ target: depSymbols[0], confidence: 0.72, evidenceType: "import_single_symbol_guess" });
          }
        }
      }

      const sameFile = fileLocalSymbols.filter((s) => s.name === callee);
      for (const target of sameFile) {
        candidates.push({ target, confidence: 0.85, evidenceType: "same_file" });
      }

      const globalByName = symbolsByName.get(callee) ?? [];
      if (globalByName.length === 1) {
        candidates.push({ target: globalByName[0], confidence: 0.68, evidenceType: "global_unique" });
      }

      const seenTargetIds = new Set<string>();
      for (const cand of candidates.sort((a, b) => b.confidence - a.confidence)) {
        if (cand.target.id === fromId || seenTargetIds.has(cand.target.id)) continue;
        seenTargetIds.add(cand.target.id);
        addEdge({
          id: makeEdgeId(fromId, "calls", cand.target.id),
          fromId,
          toId: cand.target.id,
          kind: "calls",
          summaryEn: `Function call inferred: ${rec.name} -> ${cand.target.name}`,
          weight: 1,
          state: "inferred",
          confidence: cand.confidence,
          evidenceJson: JSON.stringify([
            {
              type: cand.evidenceType,
              value: callee,
              file: rec.fileRel,
              toFile: cand.target.fileRel,
              connectionType: "invokes",
              connectionLabel: "Invokes",
            },
          ]),
          createdAt: generatedAt,
          updatedAt: generatedAt,
        });

        if (dependsOnReturnValue(rec.body, callee)) {
          addEdge({
            id: makeEdgeId(fromId, "consumes", cand.target.id),
            fromId,
            toId: cand.target.id,
            kind: "consumes",
            summaryEn: `Return-value dependency inferred: ${rec.name} consumes output of ${cand.target.name}`,
            weight: 1,
            state: "inferred",
            confidence: Math.max(0.62, cand.confidence - 0.08),
            evidenceJson: JSON.stringify([
              {
                type: "return_value_dependency",
                value: callee,
                file: rec.fileRel,
                toFile: cand.target.fileRel,
                connectionType: "consumes_output_of",
                connectionLabel: "Consumes Output Of",
              },
            ]),
            createdAt: generatedAt,
            updatedAt: generatedAt,
          });
        }
      }
    }

    for (const op of inferDataOps(rec.body)) {
      const entityId = makeNodeId("DataEntity", op.entityKey);
      if (!nodeMap.has(entityId)) {
        addNode({
          id: entityId,
          kind: "DataEntity",
          name: op.entityLabel,
          path: null,
          signature: null,
          summaryEn: "Cross-cutting data entity inferred from function behavior.",
          descriptionEn: "Abstract data resource inferred from read/write/emission patterns in function bodies.",
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
        evidenceJson: JSON.stringify([{ type: "behavioral_regex", file: rec.fileRel }]),
        createdAt: generatedAt,
        updatedAt: generatedAt,
      });
    }
  }

  return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()], generatedAt };
}

