export type PathOverlap = {
  path: string;
  sessionIds: string[];
};

const WRITE_TOOL_RE = /write|edit|strreplace|searchreplace|applypatch|delete|updatefile|setfile|rmdir/i;

export function normalizeTouchedPath(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
}

function pathFromArgs(args: unknown): string {
  if (!args || typeof args !== "object") {
    return "";
  }
  const rec = args as Record<string, unknown>;
  const candidate = rec.path ?? rec.file_path ?? rec.target_file ?? rec.filePath;
  return typeof candidate === "string" ? candidate : "";
}

/** Best-effort write path from a cursor-agent stream-json `tool_call` event. */
export function extractWrittenPathFromToolEvent(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const rec = data as Record<string, unknown>;
  if (rec.type !== "tool_call") {
    return null;
  }
  const toolCall = rec.tool_call;
  if (!toolCall || typeof toolCall !== "object") {
    return null;
  }
  const toolType = Object.keys(toolCall as object)[0] || "";
  if (!WRITE_TOOL_RE.test(toolType)) {
    return null;
  }
  const toolData = (toolCall as Record<string, unknown>)[toolType];
  const fromNamed = pathFromArgs(
    toolData && typeof toolData === "object" ? (toolData as { args?: unknown }).args ?? toolData : null,
  );
  const path = normalizeTouchedPath(fromNamed);
  return path || null;
}

export function findPathOverlaps(bySession: Map<string, Iterable<string>>): PathOverlap[] {
  const owners = new Map<string, string[]>();
  for (const [sessionId, paths] of bySession) {
    if (!sessionId) {
      continue;
    }
    for (const raw of paths) {
      const path = normalizeTouchedPath(raw);
      if (!path) {
        continue;
      }
      const list = owners.get(path) ?? [];
      if (!list.includes(sessionId)) {
        list.push(sessionId);
      }
      owners.set(path, list);
    }
  }
  return [...owners.entries()]
    .filter(([, sessionIds]) => sessionIds.length > 1)
    .map(([path, sessionIds]) => ({ path, sessionIds: [...sessionIds].sort() }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function buildResolverPrompt(input: {
  overlaps: PathOverlap[];
  sessions: Array<{ id: string; preview?: string; writtenPaths: string[] }>;
  gitStatus: string;
  gitDiffExcerpt: string;
}): string {
  const overlapLines =
    input.overlaps.length > 0
      ? input.overlaps
          .map((row) => `- ${row.path} (sessions: ${row.sessionIds.join(", ")})`)
          .join("\n")
      : "- (none reported)";
  const sessionLines = input.sessions
    .map((session) => {
      const paths = session.writtenPaths.length ? session.writtenPaths.join(", ") : "(none)";
      const preview = (session.preview || "").replace(/\s+/g, " ").slice(0, 160);
      return `- ${session.id}${preview ? ` — ${preview}` : ""}\n  files: ${paths}`;
    })
    .join("\n");
  const status = (input.gitStatus || "(empty)").slice(0, 4000);
  const diff = (input.gitDiffExcerpt || "(empty)").slice(0, 12000);
  return [
    "You are a conflict-resolver agent for Winnow.",
    "Two or more agent threads edited the same working tree. Do not start new features.",
    "Inspect the overlapping files, reconcile them into one coherent result, and summarize what you kept from each thread.",
    "",
    "## Overlapping paths",
    overlapLines,
    "",
    "## Threads",
    sessionLines || "- (none)",
    "",
    "## git status --short",
    "```",
    status,
    "```",
    "",
    "## git diff (excerpt)",
    "```",
    diff,
    "```",
  ].join("\n");
}
