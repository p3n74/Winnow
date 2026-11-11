import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { agentTranscriptDirForWorkspaceRoot } from "./sessionUtils.js";
import type { LiveSubagentRow, SubagentTraceStep } from "./subagents.js";

const MAX_LABEL = 140;
const MAX_FILE_BYTES = 4_000_000;

type ParsedTranscript = {
  promptHead: string;
  steps: SubagentTraceStep[];
  status: "running" | "done";
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clip(text: string, max = MAX_LABEL): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) {
    return "";
  }
  if (flat.length <= max) {
    return flat;
  }
  return `${flat.slice(0, max - 1)}…`;
}

function nameFromPrompt(prompt: string): string {
  const stripped = prompt
    .replace(/<timestamp>[\s\S]*?<\/timestamp>/gi, " ")
    .replace(/<\/?user_query>/gi, " ");
  const line = stripped
    .split(/\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 12);
  return clip(line || "Subagent", 72);
}

function toolLabel(name: string, input: unknown): string {
  const obj = asRecord(input) ?? {};
  const path = asString(obj.path) || asString(obj.file_path) || asString(obj.target_file);
  const command = asString(obj.command);
  const pattern = asString(obj.pattern) || asString(obj.query) || asString(obj.glob_pattern) || asString(obj.glob);
  const toolName = asString(obj.toolName) || asString(obj.tool_name);
  let detail = "";
  if (pattern) {
    detail = clip(pattern, 80);
  } else if (command) {
    detail = clip(command, 80);
  } else if (path) {
    detail = basename(path);
  } else if (toolName) {
    detail = toolName;
  }
  const tool = name || "tool";
  return detail ? `${tool} ${detail}` : tool;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  const blocks = Array.isArray(content) ? content : [];
  const parts: string[] = [];
  for (const block of blocks) {
    const obj = asRecord(block);
    if (!obj) {
      continue;
    }
    if (asString(obj.type) === "text" || obj.text) {
      const text = asString(obj.text);
      if (text) {
        parts.push(text);
      }
    }
  }
  return parts.join("\n");
}

function stepsFromContent(content: unknown): SubagentTraceStep[] {
  if (typeof content === "string") {
    const label = clip(content);
    return label ? [{ kind: "say", label }] : [];
  }
  const blocks = Array.isArray(content) ? content : [];
  const steps: SubagentTraceStep[] = [];
  for (const block of blocks) {
    const obj = asRecord(block);
    if (!obj) {
      continue;
    }
    const type = asString(obj.type);
    if (type === "tool_use" || type === "tool_call") {
      const label = toolLabel(asString(obj.name) || "tool", obj.input ?? obj.arguments ?? obj.args);
      steps.push({ kind: "tool", label });
      continue;
    }
    const text = asString(obj.text);
    if ((type === "text" || text) && text) {
      const label = clip(text);
      if (label) {
        steps.push({ kind: "say", label });
      }
    }
  }
  return steps;
}

function messageContent(row: Record<string, unknown>): unknown {
  const message = asRecord(row.message);
  if (message && "content" in message) {
    return message.content;
  }
  return row.content;
}

/**
 * Turn one Cursor subagent jsonl transcript into a short work log.
 * The last assistant turn that still contains a tool call is treated as in progress.
 */
export function parseSubagentTranscript(jsonl: string): ParsedTranscript {
  const steps: SubagentTraceStep[] = [];
  let promptHead = "";
  let lastAssistantSteps: SubagentTraceStep[] = [];
  let sawAssistant = false;

  for (const rawLine of jsonl.split(/\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    let row: Record<string, unknown> | null = null;
    try {
      row = asRecord(JSON.parse(line));
    } catch {
      continue;
    }
    if (!row) {
      continue;
    }
    const role = asString(row.role);
    const content = messageContent(row);
    if (role === "user" && !promptHead) {
      promptHead = textFromContent(content).slice(0, 500);
      continue;
    }
    if (role !== "assistant") {
      continue;
    }
    const turn = stepsFromContent(content);
    if (!turn.length) {
      continue;
    }
    sawAssistant = true;
    lastAssistantSteps = turn;
    steps.push(...turn);
  }

  const lastHasTool = lastAssistantSteps.some((step) => step.kind === "tool");
  const status: "running" | "done" = sawAssistant && !lastHasTool ? "done" : "running";
  return { promptHead, steps, status };
}

export function subagentTranscriptDir(
  workspaceRoot: string,
  cursorSessionId: string,
  transcriptsRoot?: string,
): string {
  const base = transcriptsRoot ?? agentTranscriptDirForWorkspaceRoot(workspaceRoot);
  return join(base, cursorSessionId, "subagents");
}

export async function countCursorSubagentFiles(
  workspaceRoot: string,
  cursorSessionId: string,
  transcriptsRoot?: string,
): Promise<number> {
  const chatId = cursorSessionId.trim();
  if (!chatId) {
    return 0;
  }
  try {
    const names = await readdir(subagentTranscriptDir(workspaceRoot, chatId, transcriptsRoot));
    return names.filter((name) => name.endsWith(".jsonl")).length;
  } catch {
    return 0;
  }
}

export async function readCursorSubagentTraces(input: {
  workspaceRoot: string;
  cursorSessionId: string;
  titles?: string[];
  parentFinished?: boolean;
  transcriptsRoot?: string;
}): Promise<LiveSubagentRow[]> {
  const chatId = input.cursorSessionId.trim();
  if (!chatId) {
    return [];
  }
  const dir = subagentTranscriptDir(input.workspaceRoot, chatId, input.transcriptsRoot);
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }

  const files = await Promise.all(
    names.map(async (name) => {
      const file = join(dir, name);
      try {
        const info = await stat(file);
        return { file, name, stamp: info.birthtimeMs || info.mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  files.sort((a, b) => (a?.stamp ?? 0) - (b?.stamp ?? 0));

  const titles = (input.titles ?? []).map((title) => clip(title, 72)).filter(Boolean);
  const traces: LiveSubagentRow[] = [];
  let index = 0;
  for (const entry of files) {
    if (!entry) {
      continue;
    }
    let raw = "";
    try {
      raw = await readFile(entry.file, { encoding: "utf8" });
      if (raw.length > MAX_FILE_BYTES) {
        // Keep the opening prompt (for the title) and the latest turns (for the live log).
        raw = `${raw.slice(0, 20_000)}\n${raw.slice(-MAX_FILE_BYTES)}`;
      }
    } catch {
      continue;
    }
    const parsed = parseSubagentTranscript(raw);
    const id = entry.name.replace(/\.jsonl$/i, "");
    const titled = titles[index] || "";
    const name = titled || nameFromPrompt(parsed.promptHead);
    const last = parsed.steps[parsed.steps.length - 1];
    const status = input.parentFinished ? "done" : parsed.status;
    traces.push({
      id,
      name,
      status,
      summary: last?.label || name,
      steps: parsed.steps,
    });
    index += 1;
  }
  return traces;
}
