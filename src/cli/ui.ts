import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { WinnowConfig } from "../config/schema.js";
import { getStatusSnapshot } from "./status.js";
import { saveProjectProfile } from "../config/projectProfile.js";

type UiOptions = {
  port: number;
  openBrowser: boolean;
  host: string;
  token?: string;
};

type ProfileUpdateRequest = {
  backend?: "ollama" | "deepseek_api";
  model?: string;
  glossary?: string;
  mode?: "zh" | "raw" | "dual";
};

type AgentStartRequest = {
  prompt: string;
  args?: string;
  modelPreference?: "auto" | "composer";
};

type AgentSession = {
  id: string;
  status: "running" | "done" | "error";
  startedAt: string;
  endedAt?: string;
  output: string;
  errorOutput: string;
  exitCode?: number;
  error?: string;
  command: string;
  args: string[];
};

type SessionStreamClient = {
  res: ServerResponse;
};

type StageFilesRequest = {
  files: string[];
};

type FileListEntry = {
  name: string;
  path: string;
  type: "dir" | "file";
};

type SessionSummary = {
  id: string;
  file: string;
  updatedAt: string;
  preview: string;
};

type SessionMessage = {
  role: string;
  content: string;
  timestamp?: string;
};

type LocalSessionIndexEntry = {
  id: string;
  updatedAt: string;
  startedAt: string;
  status: "running" | "done" | "error";
  preview: string;
  source: "winnow-local";
};

type LocalSessionRecord = {
  id: string;
  projectRoot: string;
  startedAt: string;
  endedAt?: string;
  status: "running" | "done" | "error";
  args: string[];
  modelPreference: "auto" | "composer";
  prompt: string;
  output: string;
  errorOutput: string;
};

async function readRecentLogEntries(logsDir: string, limit = 50): Promise<string[]> {
  try {
    const filePath = join(process.cwd(), logsDir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    const content = await readFile(filePath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    return lines.slice(Math.max(0, lines.length - limit));
  } catch {
    return [];
  }
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function applyMode(config: WinnowConfig, mode: "zh" | "raw" | "dual"): WinnowConfig {
  if (mode === "zh") {
    return { ...config, outputMode: "en_to_zh", showOriginal: false, dualOutput: false };
  }
  if (mode === "dual") {
    return { ...config, outputMode: "en_to_zh", showOriginal: true, dualOutput: true };
  }
  return { ...config, inputMode: "off", outputMode: "off", showOriginal: false, dualOutput: false };
}

function maybeOpenBrowser(url: string): void {
  if (process.platform === "darwin") {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
  }
}

function runGitCommand(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (buf: Buffer) => {
      stdout += buf.toString("utf8");
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ ok: false, stdout: "", stderr: error.message });
    });
    child.on("close", (code: number | null) => {
      resolve({ ok: code === 0, stdout, stderr });
    });
  });
}

async function getWorkspaceChanges() {
  const status = await runGitCommand(["status", "--short"]);
  const diff = await runGitCommand(["diff"]);
  const files = status.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const candidate = line.slice(3).trim();
      const renameSplit = candidate.split(" -> ");
      return renameSplit[renameSplit.length - 1];
    });

  return {
    ok: status.ok && diff.ok,
    files,
    diff: diff.stdout,
    status: status.stdout,
    error: [status.stderr, diff.stderr].filter(Boolean).join("\n"),
  };
}

function sanitizePath(inputPath?: string): string {
  const root = process.cwd();
  const target = inputPath ? resolve(root, inputPath) : root;
  const normalized = resolve(target);
  if (!normalized.startsWith(root)) {
    return root;
  }
  return normalized;
}

async function listDirectory(dirPath?: string): Promise<{
  cwd: string;
  parent: string | null;
  entries: FileListEntry[];
}> {
  const absolute = sanitizePath(dirPath);
  const root = process.cwd();
  const dirents = await readdir(absolute, { withFileTypes: true });
  const entries: FileListEntry[] = dirents
    .filter((entry) => !entry.name.startsWith(".git"))
    .map((entry) => ({
      name: entry.name,
      path: join(absolute, entry.name),
      type: (entry.isDirectory() ? "dir" : "file") as "dir" | "file",
    }))
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "dir" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

  const parent = absolute === root ? null : resolve(absolute, "..");
  return { cwd: absolute, parent, entries };
}

async function previewPath(pathValue?: string): Promise<{ path: string; content: string }> {
  const absolute = sanitizePath(pathValue);
  const info = await stat(absolute);
  if (info.isDirectory()) {
    return { path: absolute, content: "[directory]" };
  }
  if (info.size > 200000) {
    return { path: absolute, content: "[file too large to preview]" };
  }
  const content = await readFile(absolute, "utf8");
  return { path: absolute, content };
}

function defaultAgentTranscriptDir(): string {
  const workspaceId = process.cwd().replace(/^\/+/, "").replace(/\//g, "-");
  return join(homedir(), ".cursor", "projects", workspaceId, "agent-transcripts");
}

function localSessionDir(): string {
  return join(process.cwd(), ".winnow", "sessions");
}

function localSessionIndexPath(): string {
  return join(localSessionDir(), "index.json");
}

function localSessionRecordPath(id: string): string {
  return join(localSessionDir(), `${id}.json`);
}

async function readLocalSessionIndex(): Promise<LocalSessionIndexEntry[]> {
  try {
    const content = await readFile(localSessionIndexPath(), "utf8");
    const parsed = JSON.parse(content) as LocalSessionIndexEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLocalSessionIndex(entries: LocalSessionIndexEntry[]): Promise<void> {
  await mkdir(localSessionDir(), { recursive: true });
  await writeFile(localSessionIndexPath(), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

async function upsertLocalSessionIndex(entry: LocalSessionIndexEntry): Promise<void> {
  const current = await readLocalSessionIndex();
  const next = [entry, ...current.filter((item) => item.id !== entry.id)]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 500);
  await writeLocalSessionIndex(next);
}

async function writeLocalSessionRecord(record: LocalSessionRecord): Promise<void> {
  await mkdir(localSessionDir(), { recursive: true });
  await writeFile(localSessionRecordPath(record.id), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

async function listLocalSessions(limit = 20): Promise<SessionSummary[]> {
  const index = await readLocalSessionIndex();
  return index.slice(0, Math.max(1, limit)).map((entry) => ({
    id: entry.id,
    file: localSessionRecordPath(entry.id),
    updatedAt: entry.updatedAt,
    preview: entry.preview,
  }));
}

async function readLocalSession(id: string): Promise<{ id: string; messages: SessionMessage[] }> {
  const content = await readFile(localSessionRecordPath(id), "utf8");
  const record = JSON.parse(content) as LocalSessionRecord;
  const messages: SessionMessage[] = [
    { role: "user", content: record.prompt, timestamp: record.startedAt },
  ];
  if (record.output?.trim()) {
    messages.push({ role: "assistant", content: record.output, timestamp: record.endedAt });
  }
  if (record.errorOutput?.trim()) {
    messages.push({ role: "stderr", content: record.errorOutput, timestamp: record.endedAt });
  }
  return { id, messages };
}

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

function getTranscriptDir(overrideDir?: string): string {
  return overrideDir || process.env.WINNOW_AGENT_TRANSCRIPTS_DIR || defaultAgentTranscriptDir();
}

async function listCursorSessions(limit = 20, overrideDir?: string): Promise<SessionSummary[]> {
  const dir = getTranscriptDir(overrideDir);
  const files = (await readdir(dir))
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => join(dir, name));

  const summaries: SessionSummary[] = [];
  for (const file of files) {
    const fileInfo = await stat(file);
    const content = await readFile(file, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    let preview = "";
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const row = JSON.parse(lines[i]) as Record<string, unknown>;
        preview = readStringDeep(row).slice(0, 160);
        if (preview) {
          break;
        }
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
  }

  return summaries
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, Math.max(1, limit));
}

async function readCursorSession(
  sessionId: string,
  overrideDir?: string,
): Promise<{ id: string; messages: SessionMessage[] }> {
  const dir = getTranscriptDir(overrideDir);
  const file = join(dir, `${sessionId}.jsonl`);
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

export async function runUiServer(baseConfig: WinnowConfig, options: UiOptions): Promise<void> {
  let config = { ...baseConfig };
  const sessions = new Map<string, AgentSession>();
  const streamClients = new Map<string, Set<SessionStreamClient>>();

  const requireToken = Boolean(options.token);
  const isAuthorized = (url: URL): boolean => {
    if (!requireToken) {
      return true;
    }
    return url.searchParams.get("token") === options.token;
  };

  const pushStreamEvent = (
    sessionId: string,
    event: "stdout" | "stderr" | "status" | "done",
    payload: unknown,
  ) => {
    const clients = streamClients.get(sessionId);
    if (!clients || clients.size === 0) {
      return;
    }
    const body = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) {
      client.res.write(body);
    }
  };

  const closeStreamClients = (sessionId: string) => {
    const clients = streamClients.get(sessionId);
    if (!clients) {
      return;
    }
    for (const client of clients) {
      client.res.end();
    }
    streamClients.delete(sessionId);
  };

  const forceCursorNativeConfig = (input: WinnowConfig): WinnowConfig => ({
    ...input,
    inputMode: "off",
    outputMode: "off",
    showOriginal: false,
    dualOutput: false,
  });

  const parseArgs = (raw: string): string[] => raw.split(/\s+/).map((x) => x.trim()).filter(Boolean);
  const ensureModelArg = (args: string[], preference: "auto" | "composer"): string[] => {
    if (args.includes("--model")) {
      return args;
    }
    const value = preference === "composer" ? "composer" : "auto";
    return [...args, "--model", value];
  };

  const startAgentSession = (payload: AgentStartRequest): AgentSession => {
    const nativeConfig = forceCursorNativeConfig(config);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseArgs = parseArgs(payload.args ?? "");
    const args = ensureModelArg(baseArgs, payload.modelPreference ?? "auto");
    const session: AgentSession = {
      id,
      status: "running",
      startedAt: new Date().toISOString(),
      output: "",
      errorOutput: "",
      command: nativeConfig.cursorCommand,
      args,
    };
    sessions.set(id, session);
    const startedAt = session.startedAt;
    const modelPreference = payload.modelPreference ?? "auto";
    const prompt = payload.prompt;

    void writeLocalSessionRecord({
      id,
      projectRoot: process.cwd(),
      startedAt,
      status: "running",
      args,
      modelPreference,
      prompt,
      output: "",
      errorOutput: "",
    });
    void upsertLocalSessionIndex({
      id,
      startedAt,
      updatedAt: startedAt,
      status: "running",
      preview: prompt.slice(0, 160),
      source: "winnow-local",
    });

    const child = spawn(nativeConfig.cursorCommand, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    child.on("error", (error) => {
      session.status = "error";
      session.error = error.message;
      session.endedAt = new Date().toISOString();
    });

    child.stdout?.on("data", (buf: Buffer) => {
      const chunk = buf.toString("utf8");
      session.output += chunk;
      pushStreamEvent(id, "stdout", { chunk, sessionId: id });
      void writeLocalSessionRecord({
        id,
        projectRoot: process.cwd(),
        startedAt,
        status: session.status,
        args,
        modelPreference,
        prompt,
        output: session.output,
        errorOutput: session.errorOutput,
      });
    });
    child.stderr?.on("data", (buf: Buffer) => {
      const chunk = buf.toString("utf8");
      session.errorOutput += chunk;
      pushStreamEvent(id, "stderr", { chunk, sessionId: id });
      void writeLocalSessionRecord({
        id,
        projectRoot: process.cwd(),
        startedAt,
        status: session.status,
        args,
        modelPreference,
        prompt,
        output: session.output,
        errorOutput: session.errorOutput,
      });
    });

    child.stdin?.write(`${payload.prompt}\n`);
    child.stdin?.end();

    child.on("close", (code: number | null) => {
      session.exitCode = code ?? 1;
      session.status = session.exitCode === 0 ? "done" : "error";
      session.endedAt = new Date().toISOString();
      void writeLocalSessionRecord({
        id,
        projectRoot: process.cwd(),
        startedAt,
        endedAt: session.endedAt,
        status: session.status,
        args,
        modelPreference,
        prompt,
        output: session.output,
        errorOutput: session.errorOutput,
      });
      void upsertLocalSessionIndex({
        id,
        startedAt,
        updatedAt: session.endedAt,
        status: session.status,
        preview: (session.output || prompt).slice(0, 160),
        source: "winnow-local",
      });
      pushStreamEvent(id, "status", {
        status: session.status,
        exitCode: session.exitCode,
        endedAt: session.endedAt,
      });
      pushStreamEvent(id, "done", { sessionId: id });
      closeStreamClients(id);
    });

    return session;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`);
    if (!isAuthorized(url)) {
      sendJson(res, 401, { ok: false, error: "unauthorized: invalid or missing token" });
      return;
    }

    if (url.pathname === "/api/state" && req.method === "GET") {
      const state = await getStatusSnapshot(config);
      sendJson(res, 200, state);
      return;
    }

    if (url.pathname === "/api/logs" && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const logs = await readRecentLogEntries(config.logsDir, Number.isFinite(limit) ? limit : 50);
      sendJson(res, 200, { logs });
      return;
    }

    if (url.pathname === "/api/workspace" && req.method === "GET") {
      const workspace = await getWorkspaceChanges();
      sendJson(res, 200, workspace);
      return;
    }

    if (url.pathname === "/api/workspace/stage" && req.method === "POST") {
      try {
        const payload = (await readJsonBody(req)) as StageFilesRequest;
        const files = Array.isArray(payload.files) ? payload.files.filter(Boolean) : [];
        if (files.length === 0) {
          sendJson(res, 400, { ok: false, error: "files array is required" });
          return;
        }
        const result = await runGitCommand(["add", "--", ...files]);
        sendJson(res, result.ok ? 200 : 400, {
          ok: result.ok,
          stderr: result.stderr,
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/fs/list" && req.method === "GET") {
      try {
        const target = url.searchParams.get("path") ?? undefined;
        const result = await listDirectory(target);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/fs/preview" && req.method === "GET") {
      try {
        const target = url.searchParams.get("path") ?? undefined;
        if (!target) {
          sendJson(res, 400, { ok: false, error: "path query is required" });
          return;
        }
        const result = await previewPath(target);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/profile" && req.method === "POST") {
      try {
        const payload = (await readJsonBody(req)) as ProfileUpdateRequest;
        if (payload.backend) {
          config = { ...config, translatorBackend: payload.backend };
        }
        if (payload.model) {
          config = {
            ...config,
            ollamaTranslationModel: payload.model,
            deepseekModel: payload.model,
          };
        }
        if (payload.glossary !== undefined) {
          config = { ...config, translationGlossary: payload.glossary };
        }
        if (payload.mode) {
          config = applyMode(config, payload.mode);
        }
        await saveProjectProfile(config);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/sessions" && req.method === "GET") {
      try {
        const limit = Number(url.searchParams.get("limit") ?? "20");
        const dir = url.searchParams.get("dir") ?? undefined;
        const max = Number.isFinite(limit) ? limit : 20;
        const local = await listLocalSessions(max);
        const cursor = await listCursorSessions(max, dir).catch(() => []);
        const merged = [...local, ...cursor]
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
          .slice(0, max);
        sendJson(res, 200, {
          sessions: merged,
          dir: getTranscriptDir(dir),
          localDir: localSessionDir(),
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname.startsWith("/api/sessions/") && req.method === "GET") {
      try {
        const id = url.pathname.replace("/api/sessions/", "").trim();
        const dir = url.searchParams.get("dir") ?? undefined;
        let session: { id: string; messages: SessionMessage[] };
        try {
          session = await readLocalSession(id);
        } catch {
          session = await readCursorSession(id, dir);
        }
        sendJson(res, 200, session);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/agent/start" && req.method === "POST") {
      try {
        const payload = (await readJsonBody(req)) as AgentStartRequest;
        if (!payload.prompt?.trim()) {
          sendJson(res, 400, { ok: false, error: "prompt is required" });
          return;
        }
        const session = startAgentSession(payload);
        sendJson(res, 200, { ok: true, sessionId: session.id });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname.startsWith("/api/agent/") && req.method === "GET") {
      if (url.pathname.endsWith("/stream")) {
        const id = url.pathname.replace("/api/agent/", "").replace("/stream", "").trim();
        const session = sessions.get(id);
        if (!session) {
          sendJson(res, 404, { ok: false, error: "session not found" });
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();

        const client: SessionStreamClient = { res };
        const current = streamClients.get(id) ?? new Set<SessionStreamClient>();
        current.add(client);
        streamClients.set(id, current);

        res.write(`event: status\ndata: ${JSON.stringify({ status: session.status, sessionId: id })}\n\n`);
        if (session.output) {
          res.write(`event: stdout\ndata: ${JSON.stringify({ chunk: session.output, sessionId: id })}\n\n`);
        }
        if (session.errorOutput) {
          res.write(`event: stderr\ndata: ${JSON.stringify({ chunk: session.errorOutput, sessionId: id })}\n\n`);
        }
        if (session.status !== "running") {
          res.write(`event: done\ndata: ${JSON.stringify({ sessionId: id })}\n\n`);
          res.end();
          current.delete(client);
          if (current.size === 0) {
            streamClients.delete(id);
          }
          return;
        }

        req.on("close", () => {
          const clients = streamClients.get(id);
          if (!clients) {
            return;
          }
          clients.delete(client);
          if (clients.size === 0) {
            streamClients.delete(id);
          }
        });
        return;
      }
      const id = url.pathname.replace("/api/agent/", "").trim();
      const session = sessions.get(id);
      if (!session) {
        sendJson(res, 404, { ok: false, error: "session not found" });
        return;
      }
      sendJson(res, 200, { ok: true, session });
      return;
    }

    if (url.pathname === "/" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Winnow Console UI</title>
    <style>
      :root{--bg:#071521;--panel:#0a1d2c;--panel2:#0d2436;--line:#12344b;--text:#cce6ff;--muted:#7fa3bd;--accent:#2ec4ff;}
      *{box-sizing:border-box}
      html,body{margin:0;padding:0;height:100%;background:var(--bg);color:var(--text);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
      .app{display:flex;flex-direction:column;height:100vh}
      .topbar{height:40px;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid var(--line);background:#06131e}
      .tab{padding:5px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel);font-size:12px;color:var(--muted);cursor:pointer}
      .tab.active{color:var(--text);border-color:var(--accent)}
      .body{flex:1;display:grid;grid-template-columns:38% 62%;gap:8px;padding:8px;min-height:0}
      .body.single{grid-template-columns:100%}
      .leftCol,.rightCol{display:grid;gap:8px;min-height:0}
      .leftCol{grid-template-rows:26% 16% 18% 20% 20%}
      .rightCol{grid-template-rows:58% 42%}
      .panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:8px;overflow:hidden;display:flex;flex-direction:column;min-height:0}
      .title{font-size:12px;color:#9dc4df;margin-bottom:6px}
      .muted{color:var(--muted)}
      .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      input,select,button,textarea{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:6px;padding:6px 8px;font-family:inherit;font-size:12px}
      button{cursor:pointer}
      button:hover{border-color:var(--accent)}
      pre{margin:0;background:#06131e;border:1px solid var(--line);border-radius:6px;padding:8px;white-space:pre-wrap;overflow:auto;flex:1;min-height:0;font-size:12px}
      textarea{width:100%;min-height:110px;resize:vertical}
      #workspaceFiles,#dirEntries{overflow:auto;max-height:140px;border:1px solid var(--line);border-radius:6px;padding:6px;background:#06131e}
      .entry{display:block;border:0;background:transparent;color:var(--text);text-align:left;padding:3px 4px;width:100%}
      .entry:hover{background:#103047}
      .small{font-size:11px}
    </style>
  </head>
  <body>
    <div class="app">
      <div class="topbar">
        <button class="tab active" data-view="os">OS default</button>
        <button class="tab active" data-view="os">Winnow UI</button>
        <button class="tab" data-view="agent">Cursor Agent</button>
        <button class="tab" data-view="settings">Settings</button>
      </div>
      <div class="body">
        <div class="leftCol">
          <div class="panel">
            <div class="title">Directory Navigator (ranger-like)</div>
            <div class="row small">
              <button onclick="goParent()">Up</button>
              <button onclick="refreshDir()">Refresh</button>
              <span class="muted small" id="dirCwd"></span>
            </div>
            <div id="dirEntries"></div>
            <div class="small muted" style="margin:6px 0">Preview: <span id="dirPreviewPath"></span></div>
            <pre id="dirPreview">Select a file to preview.</pre>
          </div>
          <div class="panel">
            <div class="title">Profile Controls</div>
            <div class="row small">
              <label>Backend</label>
              <select id="backend"><option value="ollama">ollama</option><option value="deepseek_api">deepseek_api</option></select>
              <button onclick="saveBackend()">Save</button>
            </div>
            <div class="row small">
              <label>Model</label>
              <input id="model" placeholder="deepseek-v4-flash" />
              <button onclick="saveModel()">Save</button>
            </div>
            <div class="row small">
              <label>Glossary</label>
              <input id="glossary" style="width:62%" placeholder="PR:拉取请求,branch:分支" />
              <button onclick="saveGlossary()">Save</button>
            </div>
            <div class="row small">
              <button onclick="setMode('zh')">ZH</button>
              <button onclick="setMode('dual')">Dual</button>
              <button onclick="setMode('raw')">Raw</button>
            </div>
            <pre id="result">Ready.</pre>
          </div>
          <div class="panel">
            <div class="title">Status</div>
            <pre id="status">Loading...</pre>
          </div>
          <div class="panel">
            <div class="title">Recent Logs</div>
            <pre id="logs">Loading...</pre>
          </div>
          <div class="panel">
            <div class="title">Cursor Sessions Sync</div>
            <div class="row small">
              <button onclick="refreshSessions()">Refresh</button>
            </div>
            <div class="small muted" id="sessionDirInfo"></div>
            <div id="sessionList" style="overflow:auto;max-height:120px;border:1px solid var(--line);border-radius:6px;padding:6px;background:#06131e"></div>
            <div class="row small" style="margin-top:6px">
              <button onclick="continueSelectedSession()">Continue Selected</button>
              <button onclick="useSelectedPrompt()">Use Last Prompt</button>
            </div>
            <pre id="sessionPreview">No session selected.</pre>
          </div>
        </div>
        <div class="rightCol">
          <div class="panel">
            <div class="title">Agent Console (Cursor Native)</div>
            <div class="row small">
              <label>Model Pref</label>
              <select id="agentModelPref">
                <option value="auto">auto</option>
                <option value="composer">composer</option>
              </select>
              <label>Cursor Args</label>
              <input id="agentArgs" style="width:55%" placeholder="optional args passed to cursor-agent" />
              <button onclick="startAgentRun()">Run Agent</button>
            </div>
            <div class="small muted" id="agentSessionInfo">No active session.</div>
            <pre id="agentOutput">No run yet.</pre>
          </div>
          <div class="panel">
            <div class="title">Prompt + Diff</div>
            <div class="row small">
              <button onclick="refreshWorkspace()">Refresh</button>
              <button onclick="stageSelected()">Stage Selected</button>
            </div>
            <div id="workspaceFiles"></div>
            <textarea id="agentPrompt" placeholder="Describe the coding task for Cursor agent..."></textarea>
            <div class="small muted" style="margin:6px 0">Current git diff</div>
            <pre id="workspaceDiff">Loading...</pre>
          </div>
        </div>
      </div>
    </div>
    <script>
      const AUTH_TOKEN = ${JSON.stringify(options.token ?? "")};
      function withToken(path){
        if(!AUTH_TOKEN){ return path; }
        const glue = path.includes('?') ? '&' : '?';
        return path + glue + 'token=' + encodeURIComponent(AUTH_TOKEN);
      }
      async function refresh(){
        const state = await fetch(withToken('/api/state')).then(r=>r.json());
        document.getElementById('status').textContent = JSON.stringify(state,null,2);
        document.getElementById('backend').value = state.backend;
        document.getElementById('model').value = state.model;
        const logs = await fetch(withToken('/api/logs?limit=60')).then(r=>r.json());
        document.getElementById('logs').textContent = (logs.logs || []).join('\\n') || 'No logs yet';
      }
      let currentDir = '';
      async function refreshDir(path){
        const url = path ? ('/api/fs/list?path=' + encodeURIComponent(path)) : '/api/fs/list';
        const data = await fetch(withToken(url)).then(r=>r.json());
        currentDir = data.cwd;
        document.getElementById('dirCwd').textContent = data.cwd;
        const parentBtn = data.parent ? '<button class="entry dir-entry" data-path="' + encodeURIComponent(data.parent) + '">[..]</button>' : '';
        const rows = (data.entries || []).map((e) => {
          const icon = e.type === 'dir' ? '[D]' : '[F]';
          const encodedPath = encodeURIComponent(e.path);
          if(e.type === 'dir'){
            return '<button class="entry dir-entry" data-path="' + encodedPath + '">' + icon + ' ' + e.name + '</button>';
          }
          return '<button class="entry file-entry" data-path="' + encodedPath + '">' + icon + ' ' + e.name + '</button>';
        }).join('');
        document.getElementById('dirEntries').innerHTML = parentBtn + rows;
        document.querySelectorAll('.dir-entry').forEach((el) => {
          el.onclick = () => refreshDir(decodeURIComponent(el.getAttribute('data-path') || ''));
        });
        document.querySelectorAll('.file-entry').forEach((el) => {
          el.onclick = () => previewFile(decodeURIComponent(el.getAttribute('data-path') || ''));
        });
      }
      async function goParent(){
        if(!currentDir){ return; }
        await refreshDir(currentDir + '/..');
      }
      async function previewFile(path){
        const data = await fetch(withToken('/api/fs/preview?path=' + encodeURIComponent(path))).then(r=>r.json());
        document.getElementById('dirPreviewPath').textContent = path;
        document.getElementById('dirPreview').textContent = data.content || '';
      }
      async function refreshWorkspace(){
        const ws = await fetch(withToken('/api/workspace')).then(r=>r.json());
        const files = ws.files || [];
        const list = files.map((f, idx) =>
          '<label style="display:block"><input type="checkbox" class="ws-file" data-file="' + f.replace(/"/g,'&quot;') + '"' + (idx === 0 ? ' checked' : '') + '> ' + f + '</label>'
        ).join('');
        document.getElementById('workspaceFiles').innerHTML = list || '<span class="muted small">No changes.</span>';
        document.getElementById('workspaceDiff').textContent = ws.diff || ws.status || ws.error || 'No diff.';
      }
      async function stageSelected(){
        const nodes = Array.from(document.querySelectorAll('.ws-file')).filter(n => n.checked);
        const files = nodes.map(n => n.getAttribute('data-file')).filter(Boolean);
        if(files.length === 0){
          document.getElementById('result').textContent = 'No files selected to stage.';
          return;
        }
        const res = await fetch(withToken('/api/workspace/stage'),{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({files})
        }).then(r=>r.json());
        document.getElementById('result').textContent = JSON.stringify(res,null,2);
        await refreshWorkspace();
      }
      async function post(data){
        const res = await fetch(withToken('/api/profile'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());
        document.getElementById('result').textContent = JSON.stringify(res,null,2);
        await refresh();
      }
      async function saveBackend(){ await post({backend:document.getElementById('backend').value}); }
      async function saveModel(){ await post({model:document.getElementById('model').value.trim()}); }
      async function saveGlossary(){ await post({glossary:document.getElementById('glossary').value}); }
      async function setMode(mode){ await post({mode}); }
      let activeSessionId = null;
      let pollTimer = null;
      let streamSource = null;
      let selectedSyncedSession = null;
      let selectedSyncedMessages = [];
      function setView(view){
        document.querySelectorAll('.tab').forEach((tab) => {
          tab.classList.toggle('active', tab.getAttribute('data-view') === view);
        });
        const body = document.querySelector('.body');
        const leftCol = document.querySelector('.leftCol');
        const rightCol = document.querySelector('.rightCol');
        body.classList.remove('single');
        leftCol.style.display = '';
        rightCol.style.display = '';
        if(view === 'agent'){
          body.classList.add('single');
          leftCol.style.display = 'none';
        } else if(view === 'settings'){
          body.classList.add('single');
          rightCol.style.display = 'none';
        }
      }
      async function pollAgent(){
        if(!activeSessionId){ return; }
        const res = await fetch(withToken('/api/agent/' + activeSessionId)).then(r=>r.json());
        if(!res.ok){ return; }
        const s = res.session;
        const output = (s.output || '') + (s.errorOutput ? ('\\n[stderr]\\n' + s.errorOutput) : '');
        document.getElementById('agentOutput').textContent = output || 'Running...';
        document.getElementById('agentSessionInfo').textContent = 'session=' + s.id + ' status=' + s.status + (s.exitCode !== undefined ? (' exit=' + s.exitCode) : '');
        if(s.status !== 'running' && pollTimer){
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }
      function closeStream(){
        if(streamSource){
          streamSource.close();
          streamSource = null;
        }
      }
      function attachStream(sessionId){
        closeStream();
        streamSource = new EventSource(withToken('/api/agent/' + sessionId + '/stream'));
        streamSource.addEventListener('stdout', (evt) => {
          const data = JSON.parse(evt.data || '{}');
          const out = document.getElementById('agentOutput');
          out.textContent = (out.textContent === 'Running...' ? '' : out.textContent) + (data.chunk || '');
        });
        streamSource.addEventListener('stderr', (evt) => {
          const data = JSON.parse(evt.data || '{}');
          const out = document.getElementById('agentOutput');
          const prefix = out.textContent && !out.textContent.endsWith('\\n') ? '\\n' : '';
          out.textContent = (out.textContent === 'Running...' ? '' : out.textContent) + prefix + '[stderr]\\n' + (data.chunk || '');
        });
        streamSource.addEventListener('status', (evt) => {
          const data = JSON.parse(evt.data || '{}');
          document.getElementById('agentSessionInfo').textContent = 'session=' + sessionId + ' status=' + (data.status || 'running') + (data.exitCode !== undefined ? (' exit=' + data.exitCode) : '');
        });
        streamSource.addEventListener('done', () => {
          closeStream();
          if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
          pollAgent();
        });
        streamSource.onerror = () => {
          closeStream();
          if(!pollTimer){ pollTimer = setInterval(pollAgent, 1000); }
        };
      }
      async function startAgentRun(){
        const prompt = document.getElementById('agentPrompt').value.trim();
        if(!prompt){
          document.getElementById('agentOutput').textContent = 'Prompt is required.';
          return;
        }
        const payload = {
          prompt,
          args: document.getElementById('agentArgs').value,
          modelPreference: document.getElementById('agentModelPref').value
        };
        const res = await fetch(withToken('/api/agent/start'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(r=>r.json());
        if(!res.ok){
          document.getElementById('agentOutput').textContent = 'Failed to start: ' + JSON.stringify(res);
          return;
        }
        activeSessionId = res.sessionId;
        document.getElementById('agentOutput').textContent = 'Running...';
        document.getElementById('agentSessionInfo').textContent = 'session=' + activeSessionId + ' status=running';
        if(pollTimer){ clearInterval(pollTimer); }
        pollTimer = setInterval(pollAgent, 1000);
        attachStream(activeSessionId);
        pollAgent();
      }
      async function refreshSessions(){
        const data = await fetch(withToken('/api/sessions?limit=25')).then(r=>r.json());
        document.getElementById('sessionDirInfo').textContent = 'dir: ' + (data.dir || '(unknown)');
        const rows = (data.sessions || []).map((s, idx) =>
          '<button class="entry sync-session" data-session-id="' + s.id + '"' + (idx===0 ? ' style="border:1px solid var(--accent)"' : '') + '>' +
          '[' + (s.updatedAt || '').replace('T',' ').slice(0,19) + '] ' + s.id.slice(0,8) + '  ' + (s.preview || '') +
          '</button>'
        ).join('');
        document.getElementById('sessionList').innerHTML = rows || '<span class="muted small">No transcript sessions found yet.</span>';
        document.querySelectorAll('.sync-session').forEach((el) => {
          el.onclick = () => loadSession(el.getAttribute('data-session-id'));
        });
        const first = document.querySelector('.sync-session');
        if(first){ await loadSession(first.getAttribute('data-session-id')); }
      }
      async function loadSession(id){
        if(!id){ return; }
        selectedSyncedSession = id;
        const data = await fetch(withToken('/api/sessions/' + id)).then(r=>r.json());
        selectedSyncedMessages = data.messages || [];
        const preview = selectedSyncedMessages.slice(-8).map((m) => '[' + m.role + '] ' + m.content).join('\\n\\n');
        document.getElementById('sessionPreview').textContent = preview || 'No message content.';
        document.querySelectorAll('.sync-session').forEach((el) => {
          el.style.border = el.getAttribute('data-session-id') === id ? '1px solid var(--accent)' : '1px solid transparent';
        });
      }
      function continueSelectedSession(){
        if(!selectedSyncedSession){
          document.getElementById('result').textContent = 'Select a synced session first.';
          return;
        }
        const argsEl = document.getElementById('agentArgs');
        const existing = (argsEl.value || '').trim();
        const resumeArg = '--resume ' + selectedSyncedSession;
        argsEl.value = existing.includes('--resume') ? existing : (existing ? existing + ' ' : '') + resumeArg;
        document.getElementById('result').textContent = 'Agent args updated with resume session: ' + selectedSyncedSession;
      }
      function useSelectedPrompt(){
        if(!selectedSyncedMessages || selectedSyncedMessages.length === 0){
          document.getElementById('result').textContent = 'No messages in selected session.';
          return;
        }
        const lastUserLike = [...selectedSyncedMessages].reverse().find((m) =>
          String(m.role).toLowerCase().includes('user') || String(m.role).toLowerCase().includes('human')
        );
        const pick = lastUserLike || selectedSyncedMessages[selectedSyncedMessages.length - 1];
        document.getElementById('agentPrompt').value = pick.content || '';
        document.getElementById('result').textContent = 'Loaded prompt from synced session.';
      }
      refresh();
      refreshWorkspace();
      refreshDir();
      refreshSessions();
      document.querySelectorAll('.tab').forEach((tab) => {
        tab.onclick = () => setView(tab.getAttribute('data-view') || 'os');
      });
      setView('os');
      setInterval(refresh, 3000);
    </script>
  </body>
</html>`);
      return;
    }

    res.statusCode = 404;
    res.end("Not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port, options.host, () => resolve());
  });

  const queryToken = options.token ? `?token=${encodeURIComponent(options.token)}` : "";
  const localUrl = `http://127.0.0.1:${options.port}${queryToken}`;
  const boundUrl = `http://${options.host}:${options.port}${queryToken}`;
  process.stdout.write(`[winnow-ui] running at ${boundUrl}\n`);
  if (options.token) {
    process.stdout.write(`[winnow-ui] access token: ${options.token}\n`);
  }
  if (options.host === "0.0.0.0") {
    const ifaces = networkInterfaces();
    const ips: string[] = [];
    for (const values of Object.values(ifaces)) {
      for (const iface of values ?? []) {
        if (iface.family === "IPv4" && !iface.internal) {
          ips.push(iface.address);
        }
      }
    }
    if (ips.length > 0) {
      process.stdout.write(`[winnow-ui] LAN URLs:\n`);
      for (const ip of ips) {
        process.stdout.write(`  - http://${ip}:${options.port}${queryToken}\n`);
      }
    }
  } else {
    process.stdout.write(`[winnow-ui] local URL: ${localUrl}\n`);
  }
  process.stdout.write("[winnow-ui] press Ctrl+C to stop\n");
  if (options.openBrowser) {
    maybeOpenBrowser(options.host === "0.0.0.0" ? localUrl : boundUrl);
  }
}
