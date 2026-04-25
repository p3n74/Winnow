import { exec } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { readdir, readFile, realpath, stat } from "node:fs/promises";

const execAsync = promisify(exec);

export type SessionSummary = {
  id: string;
  file: string;
  updatedAt: string;
  preview: string;
};

/**
 * Cursor stores transcripts under ~/.cursor/projects/<workspace-id>/agent-transcripts
 * where <workspace-id> is derived from the absolute workspace path (slashes → hyphens).
 * On Windows, drive letters are lowercased and the colon is folded into the first hyphen
 * (e.g. C:\\Users\\x → c-Users-x), matching Cursor's folder naming.
 */
export function cursorProjectIdFromWorkspaceRoot(absoluteWorkspacePath: string): string {
  const abs = resolve(absoluteWorkspacePath);
  const normalized = abs.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    const drive = normalized[0].toLowerCase();
    const tail = normalized.slice(3).replace(/\//g, "-");
    return `${drive}-${tail}`;
  }
  return normalized.replace(/^\/+/, "").replace(/\//g, "-");
}

export function agentTranscriptDirForWorkspaceRoot(absoluteWorkspacePath: string): string {
  const workspaceId = cursorProjectIdFromWorkspaceRoot(absoluteWorkspacePath);
  return join(homedir(), ".cursor", "projects", workspaceId, "agent-transcripts");
}

async function resolvedWorkspaceRootsForTranscripts(projectRootAbsolute: string): Promise<string[]> {
  const roots = new Set<string>([resolve(projectRootAbsolute)]);
  try {
    roots.add(await realpath(resolve(projectRootAbsolute)));
  } catch {
    // keep primary only
  }
  return [...roots];
}

async function readTranscriptSummariesInDir(transcriptDir: string): Promise<SessionSummary[]> {
  try {
    const files = (await readdir(transcriptDir))
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(transcriptDir, name));

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
        const id = basename(file).replace(/\.jsonl$/, "");
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

    return summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  } catch {
    return [];
  }
}

/**
 * List Cursor agent transcript sessions for a project folder, scanning every transcript
 * directory Cursor might use (resolved path vs realpath when the workspace is symlinked).
 */
export async function listCursorSessionsForWorkspaceRoot(
  projectRootAbsolute: string,
  limit = 20,
): Promise<SessionSummary[]> {
  const dirs = new Set<string>();
  for (const root of await resolvedWorkspaceRootsForTranscripts(projectRootAbsolute)) {
    dirs.add(agentTranscriptDirForWorkspaceRoot(root));
  }

  const merged: SessionSummary[] = [];
  for (const dir of dirs) {
    merged.push(...(await readTranscriptSummariesInDir(dir)));
  }

  const byId = new Map<string, SessionSummary>();
  for (const s of merged.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))) {
    const prev = byId.get(s.id);
    if (!prev || prev.updatedAt < s.updatedAt) {
      byId.set(s.id, s);
    }
  }

  return [...byId.values()]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, Math.max(1, limit));
}

/** Locate a transcript JSONL for this session id under any Cursor project dir for the workspace. */
export async function findCursorTranscriptJsonlPath(
  sessionId: string,
  projectRootAbsolute: string,
): Promise<string | undefined> {
  const id = basename(sessionId.trim());
  for (const root of await resolvedWorkspaceRootsForTranscripts(projectRootAbsolute)) {
    const file = join(agentTranscriptDirForWorkspaceRoot(root), `${id}.jsonl`);
    try {
      await stat(file);
      return file;
    } catch {
      // try next root
    }
  }
  return undefined;
}

export function defaultAgentTranscriptDir(): string {
  return agentTranscriptDirForWorkspaceRoot(process.cwd());
}

export function getTranscriptDir(overrideDir?: string): string {
  return overrideDir || process.env.WINNOW_AGENT_TRANSCRIPTS_DIR || defaultAgentTranscriptDir();
}

export async function createCursorSession(
  cursorCommand = "cursor-agent",
  cwd?: string,
): Promise<string> {
  try {
    const { stdout } = await execAsync(`${cursorCommand} create-chat`, cwd ? { cwd } : {});
    return stdout.trim();
  } catch (error) {
    throw new Error(`Failed to create cursor session: ${(error as Error).message}`);
  }
}

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
  const all = await readTranscriptSummariesInDir(dir);
  return all.slice(0, Math.max(1, limit));
}
