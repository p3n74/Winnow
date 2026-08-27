import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export type SubagentDefinition = {
  name: string;
  description: string;
  model?: string;
  readonly?: boolean;
  isBackground?: boolean;
  fileName?: string;
};

export type LiveSubagentRow = {
  id: string;
  name: string;
  status: string;
  summary: string;
};

/** Built-in Cursor subagents (conceptual). Winnow does not spawn them. */
export const BUILTIN_SUBAGENTS: SubagentDefinition[] = [
  { name: "explore", description: "Explore the codebase", model: "inherit" },
  { name: "bash", description: "Run shell commands", model: "inherit" },
  { name: "browser", description: "Interact with a browser", model: "inherit" },
];

export const SUBAGENTS_HINT =
  "Native Cursor subagents run inside the parent agent; Winnow does not spawn extra CLI processes.";

const AGENT_DIR_SEGMENTS = [".codex", ".claude", ".cursor"] as const;
const SUBAGENT_TOOL_NAME = /task|launch[_-]?subagent|subagent/i;

function filenameStem(filename: string): string {
  const base = basename(filename);
  return base.replace(/\.md$/i, "").trim();
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseSimpleYamlMap(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) {
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = stripQuotes(line.slice(colon + 1).trim());
    if (!key) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function extractFrontmatter(markdown: string): Record<string, string> {
  const text = String(markdown ?? "").replace(/^\uFEFF/, "");
  const match = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) {
    return {};
  }
  return parseSimpleYamlMap(match[1] ?? "");
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "0") {
    return false;
  }
  return undefined;
}

export function parseSubagentMarkdown(filename: string, markdown: string): SubagentDefinition | null {
  const attrs = extractFrontmatter(markdown);
  const name = (attrs.name || filenameStem(filename)).trim();
  if (!name) {
    return null;
  }
  const description = (attrs.description || "").trim();
  const model = (attrs.model || "").trim();
  const readonly = parseBool(attrs.readonly);
  const isBackground = parseBool(attrs.is_background);
  const def: SubagentDefinition = {
    name,
    description,
    fileName: basename(filename),
  };
  if (model) {
    def.model = model;
  }
  if (readonly !== undefined) {
    def.readonly = readonly;
  }
  if (isBackground !== undefined) {
    def.isBackground = isBackground;
  }
  return def;
}

function agentDirsForRoot(root: string): string[] {
  return AGENT_DIR_SEGMENTS.map((segment) => join(root, segment, "agents"));
}

/**
 * Scan user then project agent dirs. Later (higher-precedence) writers win by `name`.
 * Precedence: project over user; `.cursor` over `.claude` / `.codex`.
 */
export function listSubagentDefinitionFiles(projectRoot: string, userHomedir: string): SubagentDefinition[] {
  const byName = new Map<string, SubagentDefinition>();
  const dirs = [...agentDirsForRoot(userHomedir), ...agentDirsForRoot(projectRoot)];
  for (const dir of dirs) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith(".md")) {
        continue;
      }
      let markdown = "";
      try {
        markdown = readFileSync(join(dir, entry), "utf8");
      } catch {
        continue;
      }
      const parsed = parseSubagentMarkdown(entry, markdown);
      if (!parsed) {
        continue;
      }
      const key = parsed.name.trim().toLowerCase();
      if (!key) {
        continue;
      }
      byName.set(key, parsed);
    }
  }
  return [...byName.values()];
}

export function withBuiltinSubagents(defined: SubagentDefinition[]): SubagentDefinition[] {
  const names = new Set(defined.map((agent) => agent.name.trim().toLowerCase()));
  const extras = BUILTIN_SUBAGENTS.filter((agent) => !names.has(agent.name.toLowerCase()));
  return [...extras, ...defined];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function liveRow(partial: {
  id?: string;
  name?: string;
  status?: string;
  summary?: string;
}): LiveSubagentRow | null {
  const name = (partial.name || "").trim();
  const id = (partial.id || "").trim() || name;
  if (!id && !name) {
    return null;
  }
  return {
    id: id || name,
    name: name || id,
    status: (partial.status || "").trim() || "unknown",
    summary: (partial.summary || "").trim(),
  };
}

function rowFromNested(value: unknown, statusFallback: string): LiveSubagentRow | null {
  const obj = asRecord(value);
  if (!obj) {
    return null;
  }
  return liveRow({
    id: asString(obj.id) || asString(obj.agent_id) || asString(obj.subagent_id) || asString(obj.call_id),
    name:
      asString(obj.name) ||
      asString(obj.subagent_type) ||
      asString(obj.subagent) ||
      asString(obj.agent) ||
      asString(obj.type),
    status: asString(obj.status) || asString(obj.state) || statusFallback,
    summary: asString(obj.summary) || asString(obj.description) || asString(obj.message) || asString(obj.text),
  });
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function extractLiveSubagentEvents(ndjsonLineOrParsed: unknown): LiveSubagentRow | null {
  const parsed = parseMaybeJson(ndjsonLineOrParsed);
  const obj = asRecord(parsed);
  if (!obj) {
    return null;
  }

  const type = asString(obj.type);
  const subtype = asString(obj.subtype);
  const typeLooksSubagent = type.toLowerCase() === "subagent" || /subagent/i.test(type);
  const subtypeLooksSubagent = /subagent/i.test(subtype);
  const nestedSubagent = rowFromNested(obj.subagent, subtype || type);
  const nestedAgent = rowFromNested(obj.agent, subtype || type);

  if (typeLooksSubagent || subtypeLooksSubagent) {
    return (
      nestedSubagent ||
      nestedAgent ||
      liveRow({
        id: asString(obj.id) || asString(obj.agent_id) || asString(obj.subagent_id),
        name: asString(obj.name) || asString(obj.subagent_name) || asString(obj.subagent_type) || "subagent",
        status: asString(obj.status) || subtype || "running",
        summary: asString(obj.summary) || asString(obj.description) || asString(obj.message),
      })
    );
  }

  if (type === "tool_call") {
    const toolCall = asRecord(obj.tool_call) ?? {};
    const toolKeys = Object.keys(toolCall);
    const namedTool = asString(toolCall.name) || asString(obj.tool) || asString(obj.name);
    const toolName = toolKeys[0] || namedTool;
    const toolLooksSubagent = SUBAGENT_TOOL_NAME.test(toolName);
    if (!toolLooksSubagent && !nestedSubagent && !nestedAgent) {
      return null;
    }
    const toolData = asRecord(toolName ? toolCall[toolName] : null) ?? toolCall;
    const args = asRecord(toolData.args) ?? asRecord(obj.args) ?? {};
    const subagentType =
      asString(args.subagent_type) || asString(args.subagent) || asString(args.agent) || asString(args.name);
    const summary =
      asString(args.description) || asString(args.prompt) || asString(args.task) || asString(args.summary);
    const shortTool = toolName.replace(/ToolCall$/i, "") || "Task";
    return (
      nestedSubagent ||
      nestedAgent ||
      liveRow({
        id:
          asString(toolData.id) ||
          asString(toolData.call_id) ||
          asString(obj.call_id) ||
          asString(obj.id) ||
          subagentType ||
          shortTool,
        name: subagentType || shortTool,
        status: subtype || asString(toolData.status) || asString(obj.status) || "running",
        summary,
      })
    );
  }

  if (nestedSubagent) {
    return nestedSubagent;
  }
  return null;
}
