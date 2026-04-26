import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  findCursorTranscriptJsonlPath,
  getTranscriptDir,
} from "../../cursor/sessionUtils.js";
import type { SessionMessage } from "./types.js";

function readStringDeep(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const out = readStringDeep(item);
      if (out) {
        return out;
      }
    }
    return "";
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = ["content", "text", "message", "delta", "prompt", "body"];
    for (const key of keys) {
      if (key in obj) {
        const out = readStringDeep(obj[key]);
        if (out) {
          return out;
        }
      }
    }
  }
  return "";
}

export async function readCursorSession(
  sessionId: string,
  overrideDir?: string,
  projectRootForTranscripts?: string,
): Promise<{ id: string; messages: SessionMessage[] }> {
  const safeId = basename(sessionId.trim());
  let file: string;
  if (overrideDir) {
    file = join(getTranscriptDir(overrideDir), `${safeId}.jsonl`);
  } else if (process.env.WINNOW_AGENT_TRANSCRIPTS_DIR?.trim()) {
    file = join(getTranscriptDir(), `${safeId}.jsonl`);
  } else if (projectRootForTranscripts) {
    const found = await findCursorTranscriptJsonlPath(safeId, projectRootForTranscripts);
    if (!found) {
      throw new Error(`Transcript not found for session ${safeId}`);
    }
    file = found;
  } else {
    file = join(getTranscriptDir(), `${safeId}.jsonl`);
  }
  const content = await readFile(file, "utf8");
  const lines = content.trim().split("\n").filter(Boolean);
  const messages: SessionMessage[] = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      const contentText = readStringDeep(row);
      if (!contentText) {
        continue;
      }
      messages.push({
        role: String((row.role ?? row.type ?? row.event ?? "entry") as string),
        content: contentText,
        timestamp: typeof row.timestamp === "string" ? row.timestamp : undefined,
      });
    } catch {
      // ignore malformed line
    }
  }
  return { id: sessionId, messages };
}
