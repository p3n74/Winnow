import type { ProjectGraphService } from "./service.js";
import type { BusinessLogicGraph, BusinessLogicNode, GraphEdge, GraphNode } from "./types.js";

const PREAMBLE_MAX_CHARS = 4500;
/** Short tokens add noise and blow up path LIKE matches (e.g. `*.test.ts`). */
const MIN_TERM_LEN = 3;

const STOPWORDS = new Set([
  "a",
  "about",
  "also",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "bit",
  "btw",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "done",
  "dont",
  "either",
  "engine",
  "even",
  "again",
  "ever",
  "few",
  "for",
  "from",
  "get",
  "give",
  "given",
  "gives",
  "gonna",
  "got",
  "gotta",
  "had",
  "has",
  "have",
  "having",
  "hey",
  "heuristic",
  "hmm",
  "how",
  "idk",
  "if",
  "in",
  "into",
  "is",
  "isnt",
  "it",
  "its",
  "ive",
  "just",
  "kind",
  "know",
  "let",
  "lets",
  "like",
  "load",
  "lol",
  "lot",
  "maybe",
  "me",
  "might",
  "more",
  "most",
  "much",
  "must",
  "my",
  "nah",
  "need",
  "no",
  "nope",
  "not",
  "now",
  "of",
  "off",
  "ok",
  "okay",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "out",
  "over",
  "overview",
  "pls",
  "please",
  "probably",
  "quite",
  "rather",
  "really",
  "search",
  "searches",
  "searching",
  "see",
  "seem",
  "seems",
  "she",
  "should",
  "so",
  "some",
  "somewhat",
  "still",
  "such",
  "sure",
  "than",
  "thank",
  "thanks",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "thing",
  "things",
  "this",
  "those",
  "though",
  "too",
  "try",
  "trying",
  "um",
  "umm",
  "uh",
  "until",
  "upon",
  "us",
  "use",
  "used",
  "uses",
  "using",
  "very",
  "want",
  "wanna",
  "was",
  "way",
  "we",
  "well",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "without",
  "won",
  "would",
  "yeah",
  "yep",
  "yes",
  "yet",
  "you",
  "your",
  "youre",
]);

/** Strip glue punctuation so `search.` and `again.` do not become distinct noisy tokens. */
function sanitizeToken(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^[^\p{L}\p{M}\p{N}_/.\-]+/gu, "").replace(/[^\p{L}\p{M}\p{N}_]+$/gu, "");
  return s;
}

/** Very common verbs/nouns that match huge swaths of the graph in SQL LIKE search only. */
const NODE_SEARCH_EXCLUDE = new Set(["load", "process", "push", "update"]);

function pickTermsForNodeSearch(terms: string[], max: number): string[] {
  const filtered = terms.filter((t) => !NODE_SEARCH_EXCLUDE.has(t));
  if (filtered.length <= max) {
    return filtered;
  }
  return [...filtered].sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, max);
}

/** Split camelCase and separators so `load` does not match inside `loading`. */
function normalizeForWordMatch(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-./\\:;,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `term` appears as its own token (not a substring of another word). */
function termHitsInText(term: string, text: string): boolean {
  if (term.length < MIN_TERM_LEN || !text) {
    return false;
  }
  const norm = normalizeForWordMatch(text);
  if (!norm) {
    return false;
  }
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}($|[^a-z0-9])`, "iu");
  return re.test(norm);
}

function tokenizePrompt(prompt: string): string[] {
  const spaced = prompt.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const raw = spaced
    .split(/[^\p{L}\p{N}_/.\-]+/u)
    .map((chunk) => sanitizeToken(chunk))
    .filter((s) => s.length >= MIN_TERM_LEN && !STOPWORDS.has(s));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, 20);
}

function scoreTerms(terms: string[], text: string | null | undefined): number {
  if (!text || terms.length === 0) return 0;
  let score = 0;
  for (const t of terms) {
    if (t.length < MIN_TERM_LEN) continue;
    if (termHitsInText(t, text)) {
      score += t.length >= 4 ? 4 : 3;
    }
  }
  return score;
}

function expandNeighborhood(
  graphService: ProjectGraphService,
  projectRoot: string,
  seedIds: Iterable<string>,
  maxNodes: number,
  maxEdges: number,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const visited = new Set<string>();
  for (const id of seedIds) {
    visited.add(id);
  }
  let frontier = new Set<string>(visited);
  const edgeSeen = new Set<string>();
  const collectedEdges: GraphEdge[] = [];

  for (let depth = 0; depth < 3 && collectedEdges.length < maxEdges && visited.size < maxNodes; depth++) {
    const ids = [...frontier];
    if (ids.length === 0) break;
    const edges = graphService.listEdgesIncidentToNodes(projectRoot, ids, maxEdges - collectedEdges.length + 40);
    const next = new Set<string>();
    for (const e of edges) {
      if (edgeSeen.has(e.id)) continue;
      edgeSeen.add(e.id);
      collectedEdges.push(e);
      for (const nid of [e.fromId, e.toId]) {
        if (!visited.has(nid) && visited.size < maxNodes) {
          visited.add(nid);
          next.add(nid);
        }
      }
      if (collectedEdges.length >= maxEdges) break;
    }
    frontier = next;
  }

  const nodes = graphService.getNodesByIds(projectRoot, [...visited]);
  return { nodes, edges: collectedEdges };
}

function buildMarkdown(params: {
  graphUpdatedAt: string | null;
  terms: string[];
  businessHighlights: Array<{ name: string; kind: string }>;
  files: string[];
  symbols: Array<{ name: string; path: string | null }>;
  workflows: string[];
}): string {
  const lines: string[] = [
    "## Winnow project graph (heuristic seed)",
    "",
    "The following was inferred from the Winnow technical/business graph. It may be incomplete or wrong; verify in the repo before relying on it.",
    "",
  ];
  if (params.graphUpdatedAt) {
    lines.push(`Graph last updated (UTC): \`${params.graphUpdatedAt}\``);
    lines.push("");
  }
  if (params.terms.length > 0) {
    lines.push(`Matched prompt terms: ${params.terms.map((t) => `\`${t}\``).join(", ")}`);
    lines.push("");
  }
  if (params.businessHighlights.length > 0) {
    lines.push("### Business / feature hints");
    for (const b of params.businessHighlights.slice(0, 10)) {
      lines.push(`- **${b.kind}**: ${b.name}`);
    }
    lines.push("");
  }
  if (params.workflows.length > 0) {
    lines.push("### Workflows (technical graph)");
    for (const w of params.workflows.slice(0, 8)) {
      lines.push(`- ${w}`);
    }
    lines.push("");
  }
  if (params.files.length > 0) {
    lines.push("### Likely relevant files");
    for (const p of params.files.slice(0, 18)) {
      lines.push(`- \`${p}\``);
    }
    lines.push("");
  }
  if (params.symbols.length > 0) {
    lines.push("### Symbols to inspect");
    for (const s of params.symbols.slice(0, 18)) {
      const loc = s.path ? ` — \`${s.path}\`` : "";
      lines.push(`- \`${s.name}\`${loc}`);
    }
    lines.push("");
  }
  let md = lines.join("\n").trimEnd();
  if (md.length > PREAMBLE_MAX_CHARS) {
    md = md.slice(0, PREAMBLE_MAX_CHARS - 20).trimEnd() + "\n\n…(truncated)";
  }
  return md;
}

function collectHeuristicPaths(terms: string[], business: BusinessLogicGraph, pathBudget: number): string[] {
  const paths = new Set<string>();
  const pushPaths = (arr: string[]) => {
    for (const p of arr) {
      if (paths.size >= pathBudget) return;
      if (p) paths.add(p);
    }
  };
  for (const row of business.heuristicIndex.conceptToFiles) {
    if (scoreTerms(terms, row.concept) <= 0) continue;
    pushPaths(row.files.slice(0, 4));
  }
  for (const row of business.heuristicIndex.fileHints) {
    if (scoreTerms(terms, `${row.file} ${row.symbols.join(" ")}`) <= 0) continue;
    if (row.file) paths.add(row.file);
    if (paths.size >= pathBudget) break;
  }
  return [...paths];
}

function isTestLikePath(p: string): boolean {
  const lower = p.toLowerCase();
  return (
    /(^|\/)tests?(\/|$)/.test(lower) ||
    /\/__tests__\//.test(lower) ||
    /\.(test|spec)\.[a-z0-9]+$/i.test(lower) ||
    /\/(mocks?|fixtures?)(\/|$)/.test(lower)
  );
}

function rankFilePaths(files: string[], terms: string[]): string[] {
  const meaningful = terms.filter((t) => t.length >= MIN_TERM_LEN);
  const scored = files.map((p) => {
    const base = p.split(/[/\\]/).pop() || p;
    let s = 0;
    for (const t of meaningful) {
      if (termHitsInText(t, base)) s += 5;
      else if (termHitsInText(t, p)) s += 1;
    }
    if (isTestLikePath(p)) s -= 8;
    return { p, s };
  });
  scored.sort((a, b) => b.s - a.s || a.p.localeCompare(b.p));
  return scored.map((x) => x.p);
}

function rankSymbols(
  symbols: Array<{ name: string; path: string | null }>,
  terms: string[],
): Array<{ name: string; path: string | null }> {
  const meaningful = terms.filter((t) => t.length >= MIN_TERM_LEN);
  const scored = symbols.map((sym) => {
    let s = 0;
    for (const t of meaningful) {
      if (termHitsInText(t, sym.name)) s += 6;
      else if (sym.path && termHitsInText(t, sym.path)) s += 1;
    }
    if (sym.path && isTestLikePath(sym.path)) s -= 6;
    return { sym, s };
  });
  scored.sort((a, b) => b.s - a.s || a.sym.name.localeCompare(b.sym.name) || (a.sym.path ?? "").localeCompare(b.sym.path ?? ""));
  return scored.map((x) => x.sym);
}

function rankBusinessNodes(terms: string[], nodes: BusinessLogicNode[]): Array<{ node: BusinessLogicNode; score: number }> {
  const ranked: Array<{ node: BusinessLogicNode; score: number }> = [];
  for (const n of nodes) {
    const blob = [n.name, n.summaryEn, n.descriptionEn, n.sourceNodeIds.join(" ")].join(" ");
    const s = scoreTerms(terms, blob);
    if (s > 0) ranked.push({ node: n, score: s });
  }
  ranked.sort((a, b) => b.score - a.score || b.node.confidence - a.node.confidence);
  return ranked;
}

/** Meta / philosophy prompts about the tool or assistant, not the codebase. */
function isLikelyNonRepoMetaPrompt(prompt: string): boolean {
  const t = prompt.trim();
  if (!t) {
    return true;
  }
  if (/\bplay\b[\s\S]{0,160}\bdevil/i.test(t)) {
    return true;
  }
  if (/\bdevils?\s+advocate\b/i.test(t)) {
    return true;
  }
  if (/\bcritique\b[\s\S]{0,120}\b(your|our)\s+own\b/i.test(t)) {
    return true;
  }
  if (/\bhow\s+(honest|fair)\b[\s\S]{0,80}\b(you|your\s+code)\b/i.test(t)) {
    return true;
  }
  return false;
}

/** Git / VCS housekeeping prompts — the codebase graph does not help here. */
function isLikelyGitWorkflowPrompt(prompt: string): boolean {
  const t = prompt.trim().toLowerCase();
  if (!t) {
    return false;
  }
  if (/\bcommit\s+message\b/.test(t)) {
    return true;
  }
  if (/\banalyze\s+what\s+we\s+did\b/.test(t)) {
    return true;
  }
  if (/\breview\s+what\s+we\s+(did|changed)\b/.test(t)) {
    return true;
  }
  if (/\b(summarize|write|create|generate)\b[\s\S]{0,120}\bcommit\s+message\b/.test(t)) {
    return true;
  }
  if (/\bgit\s+(add|commit|push|pull|rebase|merge|status|log|diff)\b/.test(t)) {
    return true;
  }
  if (/\bcommit\b/.test(t) && /\bpush\b/.test(t) && /\b(message|changes|summary)\b/.test(t)) {
    return true;
  }
  return false;
}

/** Tokens so vague almost every node matches; graph seed would be noise. */
const ULTRA_BROAD_GRAPH_TERMS = new Set(["api", "app", "bug", "code", "data", "file", "fix", "type", "web"]);

function isLowSignalGraphTerms(terms: string[]): boolean {
  if (terms.length === 0) {
    return true;
  }
  if (terms.length === 1 && ULTRA_BROAD_GRAPH_TERMS.has(terms[0])) {
    return true;
  }
  if (terms.length <= 2 && terms.every((x) => ULTRA_BROAD_GRAPH_TERMS.has(x))) {
    return true;
  }
  return false;
}

/** Verbs that match half the UI (`update*`, `list*`, `*All`) when editing a named doc. */
const DOC_EDIT_GENERIC_TERMS = new Set(["all", "list", "update"]);

function extractDocPathHintsFromPrompt(prompt: string): string[] {
  const out = new Set<string>();
  const re = /\b([A-Za-z0-9][A-Za-z0-9_/.\-]*\.(?:md|mdx|txt|rst))\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) {
    const raw = m[1].trim().replace(/\\/g, "/");
    if (raw.length >= 4) {
      out.add(raw.toLowerCase());
    }
  }
  return [...out];
}

/** When the user names a doc file, drop generic verbs so scoring follows the doc + real nouns (`features`, etc.). */
function narrowTermsForDocEdit(terms: string[], docHints: string[]): string[] {
  if (docHints.length === 0) {
    return terms;
  }
  const next = terms.filter((t) => !DOC_EDIT_GENERIC_TERMS.has(t) || t.includes("."));
  return next.length > 0 ? next : terms;
}

function seedIdsFromDocPathHints(
  graphService: ProjectGraphService,
  projectRoot: string,
  docHints: string[],
  seedIds: Set<string>,
): void {
  for (const hint of docHints) {
    const leaf = hint.split("/").pop() || hint;
    if (leaf.length < 2) continue;
    const leafLower = leaf.toLowerCase();
    const hits = graphService.searchNodesByTerms(projectRoot, [leafLower], 24);
    for (const n of hits) {
      if (n.kind !== "File" || !n.path) continue;
      const pl = n.path.toLowerCase();
      if (pl.endsWith("/" + leafLower) || pl.endsWith(leafLower)) {
        seedIds.add(n.id);
      }
    }
  }
}

/**
 * Builds a markdown preamble from the project graph (technical SQLite + derived business layer)
 * so the agent can narrow scope before broad repo exploration.
 */
export function buildAgentGraphContextPreamble(
  graphService: ProjectGraphService,
  projectRoot: string,
  userPrompt: string,
): string {
  try {
    const summary = graphService.summary(projectRoot);
    if (summary.nodesTotal === 0) {
      return "";
    }

    if (isLikelyNonRepoMetaPrompt(userPrompt)) {
      return "";
    }
    if (isLikelyGitWorkflowPrompt(userPrompt)) {
      return "";
    }

    const terms = tokenizePrompt(userPrompt);
    if (isLowSignalGraphTerms(terms)) {
      return "";
    }

    const docHints = extractDocPathHintsFromPrompt(userPrompt);
    const scoringTerms = narrowTermsForDocEdit(terms, docHints);
    const termsForPreview = docHints.length > 0 ? scoringTerms : terms;

    const business = graphService.businessLogicGraph(projectRoot, "full");

    const seedIds = new Set<string>();
    const ranked = rankBusinessNodes(scoringTerms, business.nodes);
    for (const { node } of ranked.slice(0, 18)) {
      for (const sid of node.sourceNodeIds) {
        seedIds.add(sid);
      }
    }

    for (const g of business.overview.keyGoals) {
      if (scoreTerms(scoringTerms, g) <= 0) continue;
      const match = business.nodes.find((n) => n.kind === "BusinessGoal" && n.name === g);
      if (match) for (const sid of match.sourceNodeIds) seedIds.add(sid);
    }
    for (const c of business.overview.keyCapabilities) {
      if (scoreTerms(scoringTerms, c) <= 0) continue;
      const match = business.nodes.find((n) => n.kind === "BusinessCapability" && n.name === c);
      if (match) for (const sid of match.sourceNodeIds) seedIds.add(sid);
    }

    for (const row of business.heuristicIndex.workflowToSymbols) {
      if (scoreTerms(scoringTerms, `${row.workflow} ${row.symbols.join(" ")}`) <= 0) continue;
      const wfNode = business.nodes.find((n) => n.kind === "BusinessProcess" && n.name === row.workflow);
      if (wfNode) for (const sid of wfNode.sourceNodeIds) seedIds.add(sid);
    }

    const hintPaths = collectHeuristicPaths(scoringTerms, business, 24);
    if (hintPaths.length > 0) {
      const fileNodes = graphService.getFileNodesByPaths(projectRoot, hintPaths, 40);
      for (const fn of fileNodes) {
        seedIds.add(fn.id);
      }
    }

    if (scoringTerms.length > 0) {
      const techHits = graphService.searchNodesByTerms(projectRoot, pickTermsForNodeSearch(scoringTerms, 10), 48);
      for (const n of techHits) {
        seedIds.add(n.id);
      }
    }

    seedIdsFromDocPathHints(graphService, projectRoot, docHints, seedIds);

    if (seedIds.size === 0) {
      return "";
    }

    const { nodes } = expandNeighborhood(graphService, projectRoot, seedIds, 96, 160);

    const files: string[] = [];
    const seenFile = new Set<string>();
    for (const n of nodes) {
      if (n.kind !== "File" || !n.path) continue;
      if (seenFile.has(n.path)) continue;
      seenFile.add(n.path);
      files.push(n.path);
    }
    const filesRanked = rankFilePaths(files, scoringTerms);
    const filesTextMatched = filesRanked.filter((p) => scoreTerms(scoringTerms, p) > 0);
    const filesForMd = filesTextMatched.length > 0 ? filesTextMatched : filesRanked.slice(0, 10);

    const symbols: Array<{ name: string; path: string | null }> = [];
    const seenSym = new Set<string>();
    for (const n of nodes) {
      if (n.kind !== "Symbol") continue;
      const key = `${n.name}\0${n.path ?? ""}`;
      if (seenSym.has(key)) continue;
      seenSym.add(key);
      symbols.push({ name: n.name, path: n.path });
    }
    const symbolsRanked = rankSymbols(symbols, scoringTerms);
    const symbolsTextMatched = symbolsRanked.filter((s) => scoreTerms(scoringTerms, `${s.name} ${s.path ?? ""}`) > 0);
    const symbolsForMd = symbolsTextMatched.length > 0 ? symbolsTextMatched : symbolsRanked.slice(0, 8);

    const workflows: string[] = [];
    const seenWf = new Set<string>();
    for (const n of nodes) {
      if (n.kind !== "Workflow") continue;
      if (seenWf.has(n.name)) continue;
      seenWf.add(n.name);
      workflows.push(n.name);
    }
    const workflowsFiltered = workflows.filter((w) => scoreTerms(scoringTerms, w) > 0).sort((a, b) => a.localeCompare(b));

    const businessHighlightSeen = new Set<string>();
    const businessHighlights: Array<{ name: string; kind: string }> = [];
    for (const { node } of ranked) {
      const key = `${node.kind}::${node.name}`;
      if (businessHighlightSeen.has(key)) continue;
      businessHighlightSeen.add(key);
      businessHighlights.push({ name: node.name, kind: node.kind });
      if (businessHighlights.length >= 8) break;
    }

    return buildMarkdown({
      graphUpdatedAt: summary.updatedAt,
      terms: termsForPreview,
      businessHighlights,
      files: filesForMd,
      symbols: symbolsForMd,
      workflows: workflowsFiltered,
    });
  } catch {
    return "";
  }
}
