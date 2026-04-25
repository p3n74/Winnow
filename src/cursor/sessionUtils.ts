import { exec } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";

const execAsync = promisify(exec);

export function defaultAgentTranscriptDir(): string {
  const workspaceId = process.cwd().replace(/^\/+/, "").replace(/\//g, "-");
  return join(homedir(), ".cursor", "projects", workspaceId, "agent-transcripts");
}

export function getTranscriptDir(overrideDir?: string): string {
  return overrideDir || process.env.WINNOW_AGENT_TRANSCRIPTS_DIR || defaultAgentTranscriptDir();
}

export async function createCursorSession(cursorCommand = "cursor-agent"): Promise<string> {
  try {
    const { stdout } = await execAsync(`${cursorCommand} create-chat`);
    return stdout.trim();
  } catch (error) {
    throw new Error(`Failed to create cursor session: ${(error as Error).message}`);
  }
}

export type SessionSummary = {
  id: string;
  file: string;
  updatedAt: string;
  preview: string;
};

function readStringDeep(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const out = readStringDeep(item);
      if (out) return out;
    }
    return "";
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = ["content", "text", "message", "delta", "prompt", "body"];
    for (const key of keys) {
      if (key in obj) {
        const out = readStringDeep(obj[key]);
        if (out) return out;
      }
    }
  }
  return "";
}

export async function listCursorSessions(limit = 20, overrideDir?: string): Promise<SessionSummary[]> {
  const dir = getTranscriptDir(overrideDir);
  try {
    const files = (await readdir(dir))
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(dir, name));

    const summaries: SessionSummary[] = [];
    for (const file of files) {
      try {
        const fileInfo = await stat(file);
        const content = await readFile(file, "utf8");
        const lines = content.trim().split("\n").filter(Boolean);
        let preview = "";
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          try {
            const row = JSON.parse(lines[i]) as Record<string, unknown>;
            preview = readStringDeep(row).slice(0, 160);
            if (preview) break;
          } catch {
            // ignore malformed line
          }
        }
        const id = file.split("/").pop()!.replace(/\.jsonl$/, "");
        summaries.push({
          id,
          file,
          updatedAt: fileInfo.mtime.toISOString(),
          preview: preview || "(no text preview)",
        });
      } catch {
        // ignore errors for specific files
      }
    }

    return summaries
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, Math.max(1, limit));
  } catch {
    return [];
  }
}
