import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { accessSync, constants as fsConstants } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import pty from "node-pty";
import { WinnowConfig } from "../config/schema.js";
import { getStatusSnapshot } from "./status.js";
import { saveProjectProfile } from "../config/projectProfile.js";
import { buildAgentWindowPageHtml } from "./agentWindowHtml.js";
import { 
  defaultAgentTranscriptDir, 
  getTranscriptDir, 
  listCursorSessions, 
  SessionSummary 
} from "../cursor/sessionUtils.js";

type UiOptions = {
  port: number;
  openBrowser: boolean;
  host: string;
  token?: string;
  paneCommands?: Record<"1" | "2" | "3" | "4" | "5", string>;
};

type PaneId = "1" | "2" | "3" | "4" | "5";

const DEFAULT_PANE_COMMANDS: Record<PaneId, string> = {
  "1": "ranger",
  "2": "cursor-agent",
  "3": "htop",
  "4": "netwatch",
  "5": process.env.SHELL || "zsh",
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
  modelPreference?: "default" | "auto" | "composer";
  autonomyMode?: boolean;
  sessionId?: string;
};

type AgentEvent = {
  id: string;
  ts: string;
  kind: "user" | "assistant" | "stderr" | "status" | "tool" | "system";
  content: string;
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
  events: AgentEvent[];
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
  modelPreference: "default" | "auto" | "composer";
  prompt: string;
  output: string;
  errorOutput: string;
  events?: AgentEvent[];
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

function buildMainTerminalHtml(token?: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Winnow Main Terminal Grid</title>
    <link rel="stylesheet" href="https://unpkg.com/@xterm/xterm/css/xterm.css" />
    <style>
      :root{--bg:#090d14;--panel:#121927;--panel2:#0f1521;--line:#25324a;--lineSoft:#1a2436;--text:#d9e7ff;--muted:#8fa3c4;--accent:#6ec7ff;--radius:10px}
      *{box-sizing:border-box}
      html,body{margin:0;width:100%;height:100%;background:radial-gradient(1200px 700px at 30% -10%, #1a2740 0%, var(--bg) 52%);color:var(--text);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
      .workspace{display:grid;grid-template-rows:44px 1fr;height:100vh;width:100%}
      .toolbar{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--line);background:rgba(10,14,22,.78);backdrop-filter:blur(6px)}
      .toolbarLeft,.toolbarRight{display:flex;gap:8px;align-items:center}
      .brand{font-size:12px;color:var(--muted)}
      .chip{font-size:11px;color:#b9d0ef;border:1px solid var(--line);padding:3px 8px;border-radius:999px;background:#121b2a}
      .back{border:1px solid var(--line);background:#151d2d;color:var(--text);padding:5px 10px;border-radius:7px;font-size:12px;text-decoration:none}
      .root{display:grid;grid-template-columns:48% 52%;gap:10px;padding:10px;min-width:0;min-height:0}
      .left{display:grid;grid-template-rows:50% 50%;gap:10px;min-width:0;min-height:0}
      .leftBottom{display:grid;grid-template-columns:42% 58%;gap:10px;min-width:0;min-height:0}
      .leftBottomLeft{display:grid;grid-template-rows:58% 42%;gap:10px;min-width:0;min-height:0}
      .pane{min-width:0;min-height:0;background:linear-gradient(180deg,rgba(20,29,45,.95) 0%,rgba(13,19,31,.95) 100%);border:1px solid var(--lineSoft);border-radius:var(--radius);overflow:hidden;box-shadow:0 8px 20px rgba(0,0,0,.24)}
      .paneInner{width:100%;height:100%;display:grid;grid-template-rows:34px 1fr}
      .paneHead{border-bottom:1px solid var(--lineSoft);color:var(--muted);font-size:12px;padding:7px 10px;display:flex;align-items:center;justify-content:space-between;background:rgba(7,12,20,.55)}
      .paneTitle{display:flex;align-items:center;gap:8px;color:#c8daf7}
      .paneCmd{font-size:10px;color:#86a9d5;border:1px solid var(--line);padding:1px 6px;border-radius:999px;background:#111a2a}
      .reconnect{border:1px solid var(--line);background:#172133;color:var(--text);border-radius:7px;padding:3px 9px;font-size:11px;cursor:pointer}
      .reconnect:hover,.back:hover{border-color:var(--accent);color:#fff}
      .term{width:100%;height:100%;overflow:hidden;background:var(--panel2)}
      .cursorHost{width:100%;height:100%;border:0;background:#0b1018}
      @media (max-width: 1200px){
        .root{grid-template-columns:1fr;grid-template-rows:56% 44%}
      }
    </style>
  </head>
  <body>
    <div class="workspace">
      <div class="toolbar">
        <div class="toolbarLeft">
          <a class="back" href="${token ? `/?token=${encodeURIComponent(token)}` : "/"}">Back</a>
          <span class="brand">Winnow Main Grid</span>
        </div>
        <div class="toolbarRight">
          <span class="chip">1 ranger</span>
          <span class="chip">2 cursor</span>
          <span class="chip">3 htop</span>
          <span class="chip">4 netwatch</span>
          <span class="chip">5 shell</span>
        </div>
      </div>
      <div class="root">
      <div class="left">
        <div id="pane1Wrap" class="pane"><div class="paneInner"><div class="paneHead"><span class="paneTitle">1 File Browser <span class="paneCmd">ranger</span></span><button class="reconnect" data-pane="1">Reconnect</button></div><div id="pane1" class="term"></div></div></div>
        <div class="leftBottom">
          <div class="leftBottomLeft">
            <div id="pane3Wrap" class="pane"><div class="paneInner"><div class="paneHead"><span class="paneTitle">3 Monitor <span class="paneCmd">htop</span></span><button class="reconnect" data-pane="3">Reconnect</button></div><div id="pane3" class="term"></div></div></div>
            <div id="pane4Wrap" class="pane"><div class="paneInner"><div class="paneHead"><span class="paneTitle">4 Network <span class="paneCmd">netwatch</span></span><button class="reconnect" data-pane="4">Reconnect</button></div><div id="pane4" class="term"></div></div></div>
          </div>
          <div id="pane5Wrap" class="pane"><div class="paneInner"><div class="paneHead"><span class="paneTitle">5 Terminal <span class="paneCmd">shell</span></span><button class="reconnect" data-pane="5">Reconnect</button></div><div id="pane5" class="term"></div></div></div>
        </div>
      </div>
      <div id="pane2Wrap" class="pane">
        <div class="paneInner">
          <div class="paneHead"><span class="paneTitle">2 Cursor Workspace <span class="paneCmd">winnow-agent-ui</span></span></div>
          <iframe
            class="cursorHost"
            title="Cursor Panel"
            src="${token ? `/agent?token=${encodeURIComponent(token)}&embed=1` : "/agent?embed=1"}"
          ></iframe>
        </div>
      </div>
    </div>
    </div>
    <script src="https://unpkg.com/@xterm/xterm/lib/xterm.js"></script>
    <script src="https://unpkg.com/@xterm/addon-fit/lib/addon-fit.js"></script>
    <script>
      const AUTH_TOKEN = ${JSON.stringify(token ?? "")};
      const panes = ["1","3","4","5"];
      const paneState = new Map();
      function withToken(path){
        if(!AUTH_TOKEN){ return path; }
        const glue = path.includes("?") ? "&" : "?";
        return path + glue + "token=" + encodeURIComponent(AUTH_TOKEN);
      }
      function wsPath(paneId){
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        return withToken(protocol + "//" + location.host + "/ws/main/" + paneId);
      }
      function openPane(paneId){
        const mount = document.getElementById("pane" + paneId);
        mount.innerHTML = "";
        const term = new Terminal({
          cursorBlink:true,
          fontSize:12,
          theme:{background:"#0f1521",foreground:"#d9e7ff",cursor:"#86d6ff"}
        });
        const fit = new FitAddon.FitAddon();
        term.loadAddon(fit);
        term.open(mount);
        fit.fit();
        const ws = new WebSocket(wsPath(paneId));
        paneState.set(paneId,{term,fit,ws});
        ws.addEventListener("open",()=>{ ws.send(JSON.stringify({type:"resize",cols:term.cols,rows:term.rows})); });
        ws.addEventListener("message",(event)=>{ if(typeof event.data==="string"){ term.write(event.data); }});
        ws.addEventListener("close",()=>{ term.write("\\r\\n\\x1b[33m[connection closed]\\x1b[0m\\r\\n"); });
        ws.addEventListener("error",()=>{ term.write("\\r\\n\\x1b[31m[connection error]\\x1b[0m\\r\\n"); });
        term.onData((data)=>{ if(ws.readyState===WebSocket.OPEN){ ws.send(JSON.stringify({type:"input",data})); }});
      }
      function resizeAll(){
        panes.forEach((paneId)=>{
          const current = paneState.get(paneId);
          if(!current){ return; }
          current.fit.fit();
          if(current.ws.readyState===WebSocket.OPEN){
            current.ws.send(JSON.stringify({type:"resize",cols:current.term.cols,rows:current.term.rows}));
          }
        });
      }
      window.addEventListener("resize", resizeAll);
      panes.forEach((paneId)=>openPane(paneId));
      document.querySelectorAll(".reconnect").forEach((btn)=>{
        btn.addEventListener("click",()=>{
          const paneId = btn.getAttribute("data-pane");
          const current = paneState.get(paneId);
          if(current && current.ws){ current.ws.close(); }
          openPane(paneId);
        });
      });
      setTimeout(resizeAll, 120);
    </script>
  </body>
</html>`;
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
  if (Array.isArray(record.events) && record.events.length > 0) {
    const messages = record.events.map((event) => ({
      role: event.kind,
      content: event.content,
      timestamp: event.ts,
    }));
    return { id, messages };
  }
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
  const nodeMajor = Number(process.versions.node.split(".")[0] || "0");
  const supportsPty = nodeMajor >= 20 && nodeMajor < 23;

  const requireToken = Boolean(options.token);
  const isAuthorized = (url: URL): boolean => {
    if (!requireToken) {
      return true;
    }
    return url.searchParams.get("token") === options.token;
  };

  const paneCommands: Record<PaneId, string> = {
    ...DEFAULT_PANE_COMMANDS,
    ...(options.paneCommands ?? {}),
  };
  const mainPaneSessions = new Map<PaneId, { ws: WebSocket; ptyProcess: pty.IPty }>();
  const mainPaneWs = new WebSocketServer({ noServer: true });

  const closeMainPane = (paneId: PaneId): void => {
    const existing = mainPaneSessions.get(paneId);
    if (!existing) {
      return;
    }
    try {
      existing.ptyProcess.kill();
    } catch {
      // ignore
    }
    mainPaneSessions.delete(paneId);
  };

  const spawnMainPane = (paneId: PaneId): pty.IPty => {
    const shellCandidates = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].filter(
      (value): value is string => Boolean(value && value.trim()),
    );
    const shell = shellCandidates.find((candidate) => {
      try {
        accessSync(candidate, fsConstants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
    if (!shell) {
      throw new Error("no executable shell found for PTY");
    }
    const rawCommand = (paneCommands[paneId] || "").trim();
    const launchScript = rawCommand ? `${rawCommand}; exec ${shell}` : `exec ${shell}`;
    try {
      return pty.spawn(shell, ["-lc", launchScript], {
        name: "xterm-256color",
        cols: 120,
        rows: 36,
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
      });
    } catch {
      for (const candidate of shellCandidates) {
        try {
          return pty.spawn(candidate, [], {
            name: "xterm-256color",
            cols: 120,
            rows: 36,
            cwd: process.cwd(),
            env: process.env as Record<string, string>,
          });
        } catch {
          // keep trying candidates
        }
      }
      throw new Error(`unable to spawn shell for pane ${paneId}`);
    }
  };

  mainPaneWs.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    if (!supportsPty) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          `\r\n[main-grid disabled: Node ${process.versions.node} is unsupported for PTY]\r\n` +
            `[use Node 22 LTS and rerun: npm run setup]\r\n`,
        );
      }
      ws.close(1011, "unsupported node version for pty");
      return;
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`);
    const paneId = url.pathname.split("/").pop() as PaneId;
    if (!paneId || !["1", "2", "3", "4", "5"].includes(paneId)) {
      ws.close(1008, "invalid pane id");
      return;
    }

    closeMainPane(paneId);
    let ptyProcess: pty.IPty;
    try {
      ptyProcess = spawnMainPane(paneId);
    } catch (error) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n[failed to start pane ${paneId}: ${(error as Error).message}]\r\n`);
      }
      ws.close(1011, "pty spawn failed");
      return;
    }
    mainPaneSessions.set(paneId, { ws, ptyProcess });

    ptyProcess.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
    ptyProcess.onExit(({ exitCode }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n[process exited: ${exitCode}]\r\n`);
      }
      closeMainPane(paneId);
    });

    ws.on("message", (payload: Buffer) => {
      try {
        const message = JSON.parse(payload.toString("utf8")) as {
          type: "input" | "resize";
          data?: string;
          cols?: number;
          rows?: number;
        };
        const live = mainPaneSessions.get(paneId);
        if (!live) {
          return;
        }
        if (message.type === "input" && typeof message.data === "string") {
          live.ptyProcess.write(message.data);
        } else if (message.type === "resize" && Number.isFinite(message.cols) && Number.isFinite(message.rows)) {
          live.ptyProcess.resize(Math.max(20, Number(message.cols)), Math.max(6, Number(message.rows)));
        }
      } catch {
        // ignore malformed client message
      }
    });
    ws.on("close", () => {
      closeMainPane(paneId);
    });
  });

  const pushStreamEvent = (
    sessionId: string,
    event: "stdout" | "stderr" | "status" | "done" | "timeline",
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
  const ensureModelArg = (args: string[], preference: "default" | "auto" | "composer"): string[] => {
    if (preference === "default") {
      return args;
    }
    if (args.includes("--model")) {
      return args;
    }
    const value = preference === "composer" ? "composer" : "auto";
    return [...args, "--model", value];
  };
  const ensureExecutionArgs = (args: string[], autonomyEnabled: boolean, sessionId?: string): string[] => {
    const next = [...args];
    if (sessionId) {
      if (!next.includes("--resume")) {
        next.push("--resume", sessionId);
      }
      if (!next.includes("--print")) {
        next.push("--print");
      }
    } else {
      if (!next.includes("--print")) {
        next.push("--print");
      }
    }
    if (!next.includes("--output-format")) {
      next.push("--output-format", "stream-json");
    }
    if (!next.includes("--stream-partial-output")) {
      next.push("--stream-partial-output");
    }
    if (!autonomyEnabled) {
      return next;
    }
    const hasForce = next.includes("-f") || next.includes("--force") || next.includes("--yolo");
    if (!hasForce) {
      next.push("--force");
    }
    const hasSandboxOverride = next.includes("--sandbox");
    if (!hasSandboxOverride) {
      next.push("--sandbox", "disabled");
    }
    return next;
  };

  const startAgentSession = (payload: AgentStartRequest): AgentSession => {
    const nativeConfig = forceCursorNativeConfig(config);
    const id = (payload.sessionId || "").trim() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseArgs = parseArgs(payload.args ?? "");
    const autonomyEnabled = payload.autonomyMode !== false;
    const args = ensureExecutionArgs(
      ensureModelArg(baseArgs, payload.modelPreference ?? "default"),
      autonomyEnabled,
      id
    );
    const existing = sessions.get(id);
    const session: AgentSession = existing
      ? {
          ...existing,
          status: "running",
          endedAt: undefined,
          error: undefined,
          command: nativeConfig.cursorCommand,
          args,
          startedAt: existing.startedAt || new Date().toISOString(),
          events: existing.events ?? [],
        }
      : {
          id,
          status: "running",
          startedAt: new Date().toISOString(),
          output: "",
          errorOutput: "",
          command: nativeConfig.cursorCommand,
          args,
          events: [],
        };
    sessions.set(id, session);
    const startedAt = session.startedAt;
    const modelPreference = payload.modelPreference ?? "default";
    const prompt = payload.prompt;

    const persistRecord = () =>
      writeLocalSessionRecord({
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
        events: session.events,
      });

    const pushEvent = (kind: AgentEvent["kind"], content: string) => {
      const event: AgentEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toISOString(),
        kind,
        content,
      };
      session.events.push(event);
      if (session.events.length > 2000) {
        session.events = session.events.slice(-2000);
      }
      pushStreamEvent(id, "timeline", { sessionId: id, event });
    };

    pushEvent("user", prompt);

    void persistRecord();
    void upsertLocalSessionIndex({
      id,
      startedAt,
      updatedAt: startedAt,
      status: session.status,
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
      pushEvent("status", `spawn error: ${error.message}`);
      void persistRecord();
    });

    let stdoutBuffer = "";
    child.stdout?.on("data", (buf: Buffer) => {
      stdoutBuffer += buf.toString("utf8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.type === "assistant" && data.message?.content) {
            // Only process partial stream chunks to avoid double-printing full collapsed blocks
            if (!data.model_call_id) {
              const text = data.message.content.map((c: any) => c.text).join("");
              session.output += text;
              pushEvent("assistant", text);
            }
          } else if (data.type === "tool_call") {
            const toolType = Object.keys(data.tool_call || {})[0] || "tool";
            const toolData = (data.tool_call || {})[toolType] || {};
            
            let action = toolType.replace("ToolCall", "");
            let target = "";
            
            if (toolData.args?.path) {
              target = toolData.args.path.split("/").pop() || toolData.args.path;
            } else if (toolData.args?.command) {
              target = toolData.args.command;
            } else if (toolData.args?.pattern) {
              target = toolData.args.pattern;
            } else if (toolData.args?.query) {
              target = toolData.args.query;
            }

            const prefix = data.subtype === "started" ? "▶" : "✓";
            pushEvent("tool", `${prefix} ${action} ${target}`.trim());
            
            if (data.subtype === "completed") {
              // Add a newline to output to space out blocks after tool use
              session.output += "\n";
            }
          } else if (data.type === "result") {
            pushEvent("status", `result: ${data.subtype}`);
          }
        } catch (e) {
          // If it fails to parse (e.g. not using stream-json for some reason), fallback to raw text
          session.output += line + "\n";
          pushEvent("assistant", line + "\n");
        }
      }
      void persistRecord();
    });
    child.stderr?.on("data", (buf: Buffer) => {
      const chunk = buf.toString("utf8");
      session.errorOutput += chunk;
      pushEvent("stderr", chunk);
      void persistRecord();
    });

    child.stdin?.write(`${prompt}\n`);
    child.stdin?.end();

    child.on("close", (code: number | null) => {
      session.exitCode = code ?? 1;
      session.status = session.exitCode === 0 ? "done" : "error";
      session.endedAt = new Date().toISOString();
      pushEvent("status", `exit=${session.exitCode} status=${session.status}`);
      void persistRecord();
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
        if (session.events?.length) {
          for (const event of session.events.slice(-500)) {
            res.write(`event: timeline\ndata: ${JSON.stringify({ sessionId: id, event })}\n\n`);
          }
        } else {
          if (session.output) {
            res.write(`event: stdout\ndata: ${JSON.stringify({ chunk: session.output, sessionId: id })}\n\n`);
          }
          if (session.errorOutput) {
            res.write(`event: stderr\ndata: ${JSON.stringify({ chunk: session.errorOutput, sessionId: id })}\n\n`);
          }
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

    if (url.pathname === "/main" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(buildMainTerminalHtml(options.token));
      return;
    }

    if (url.pathname === "/agent" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(buildAgentWindowPageHtml(options.token));
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
      .rightCol{grid-template-rows:100%}
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
      .hint{font-size:11px;color:var(--muted)}
      .quickbar{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
      .quickbar button{padding:4px 8px;font-size:11px}
      .runRow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
      .kbd{border:1px solid var(--line);border-bottom-width:2px;padding:1px 6px;border-radius:6px;background:#0a1a28;color:#9dc4df;font-size:10px}
      .statusBadge{display:inline-block;padding:2px 8px;border:1px solid var(--line);border-radius:999px;font-size:11px;color:#9dc4df;background:#0a1a28}
      .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:6px 0}
      .metric{border:1px solid var(--line);border-radius:6px;padding:6px;background:#081827}
      .metricLabel{font-size:10px;color:var(--muted)}
      .metricValue{font-size:12px;color:var(--text)}
      #chatHistory{overflow:auto;border:1px solid var(--line);border-radius:6px;background:#06131e;padding:8px;flex:1;min-height:140px}
      .chatMsg{margin-bottom:8px;border:1px solid #0f2d45;border-radius:6px;padding:6px;background:#091a29}
      .chatRole{font-size:10px;color:#9dc4df;margin-bottom:4px;text-transform:uppercase}
      .chatText{white-space:pre-wrap;font-size:12px}
    </style>
  </head>
  <body>
    <div class="app">
      <div class="topbar">
        <button class="tab active" data-view="os">OS default</button>
        <button class="tab active" data-view="os">Winnow UI</button>
        <button class="tab" data-view="agent">Cursor Agent</button>
        <button class="tab" data-view="settings">Settings</button>
        <button id="mainGridBtn" class="tab">Main Grid</button>
        <a id="agentWindowLink" class="tab" href="${options.token ? "/agent?token=" + encodeURIComponent(options.token) : "/agent"}" style="text-decoration:none;color:inherit;display:inline-flex;align-items:center">Agent window</a>
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
            <div class="title">Agent Workspace (Cursor Native)</div>
            <div class="runRow small">
              <label>Model Pref</label>
              <select id="agentModelPref">
                <option value="default">default</option>
                <option value="auto">auto</option>
                <option value="composer">composer</option>
              </select>
              <label><input id="autonomyMode" type="checkbox" checked /> autonomous</label>
              <label><input id="continueMode" type="checkbox" /> continue session</label>
              <label>Cursor Args</label>
              <input id="agentArgs" style="width:55%" placeholder="optional args passed to cursor-agent" />
              <button onclick="startAgentRun()">Run Agent</button>
              <span class="kbd">Ctrl/Cmd+Enter</span>
            </div>
            <div class="row small">
              <label>Resume Session</label>
              <select id="agentSessionSelect" style="min-width:260px">
                <option value="">(new session)</option>
              </select>
              <button onclick="refreshSessions()">Reload Sessions</button>
              <button onclick="startFreshSession()">Start Fresh</button>
            </div>
            <div class="quickbar">
              <button onclick="appendPrompt('Implement the requested change with tests, then summarize what changed.')">Implement + tests</button>
              <button onclick="appendPrompt('Review this code for bugs and edge cases, then propose a minimal patch.')">Review code</button>
              <button onclick="appendPrompt('Refactor this code for readability without changing behavior.')">Refactor safely</button>
              <button onclick="clearPrompt()">Clear prompt</button>
            </div>
            <div class="small"><span class="statusBadge" id="agentStatusBadge">idle</span> <span id="agentSessionInfo">No active session.</span></div>
            <div class="hint">Tip: use <code>--resume &lt;sessionId&gt;</code> in Cursor Args to continue a session.</div>
            <div class="metrics">
              <div class="metric"><div class="metricLabel">Prompt tokens est</div><div class="metricValue" id="metricPromptTokens">0</div></div>
              <div class="metric"><div class="metricLabel">Output tokens est</div><div class="metricValue" id="metricOutputTokens">0</div></div>
              <div class="metric"><div class="metricLabel">Chunks</div><div class="metricValue" id="metricChunks">0</div></div>
              <div class="metric"><div class="metricLabel">Elapsed</div><div class="metricValue" id="metricElapsed">0s</div></div>
            </div>
            <div class="small muted" style="margin:6px 0">Thinking trace</div>
            <pre id="agentThinking">No thinking trace yet.</pre>
            <div class="small muted" style="margin:6px 0">Chat history</div>
            <div id="chatHistory"></div>
            <textarea id="agentPrompt" placeholder="Describe the coding task for Cursor agent...\n\nGood prompt pattern:\n- Goal\n- Constraints\n- Files to touch\n- Validation steps"></textarea>
          </div>
        </div>
      </div>
    </div>
    <script>
      const AUTH_TOKEN = ${JSON.stringify(options.token ?? "")};
      const PAGE_PARAMS = new URLSearchParams(window.location.search);
      const EMBED_MODE = PAGE_PARAMS.get('embed') === '1';
      const INITIAL_VIEW = PAGE_PARAMS.get('view') || 'os';
      function withToken(path){
        if(!AUTH_TOKEN){ return path; }
        const glue = path.includes('?') ? '&' : '?';
        return path + glue + 'token=' + encodeURIComponent(AUTH_TOKEN);
      }
      function openMainGrid(){
        window.location.assign(withToken('/main'));
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
      let selectedResumeSessionId = null;
      let cachedSessionRows = [];
      let agentMetrics = {
        startedAtMs: 0,
        promptChars: 0,
        outputChars: 0,
        chunkCount: 0,
      };
      let thinkingEvents = [];
      let lastTraceAtMs = 0;
      const seenTimelineIds = new Set();
      function estimateTokens(chars){
        return Math.max(0, Math.ceil(chars / 4));
      }
      function formatElapsed(ms){
        if(ms <= 0){ return '0s'; }
        const sec = Math.floor(ms / 1000);
        if(sec < 60){ return sec + 's'; }
        const min = Math.floor(sec / 60);
        const rem = sec % 60;
        return min + 'm ' + rem + 's';
      }
      function refreshMetrics(){
        document.getElementById('metricPromptTokens').textContent = String(estimateTokens(agentMetrics.promptChars));
        document.getElementById('metricOutputTokens').textContent = String(estimateTokens(agentMetrics.outputChars));
        document.getElementById('metricChunks').textContent = String(agentMetrics.chunkCount);
        const elapsed = agentMetrics.startedAtMs ? Date.now() - agentMetrics.startedAtMs : 0;
        document.getElementById('metricElapsed').textContent = formatElapsed(elapsed);
      }
      function appendChat(role, text){
        const root = document.getElementById('chatHistory');
        if(!root){ return; }

        const lastMsg = root.lastElementChild;
        if (lastMsg) {
          const roleEl = lastMsg.querySelector(".chatRole");
          if (roleEl && roleEl.textContent === role) {
            const textEl = lastMsg.querySelector(".chatText");
            if (textEl) {
              textEl.textContent += text;
              root.scrollTop = root.scrollHeight;
              return;
            }
          }
        }

        const msg = document.createElement('div');
        msg.className = 'chatMsg';
        const roleEl = document.createElement('div');
        roleEl.className = 'chatRole';
        roleEl.textContent = role;
        const textEl = document.createElement('div');
        textEl.className = 'chatText';
        textEl.textContent = text;
        msg.appendChild(roleEl);
        msg.appendChild(textEl);
        root.appendChild(msg);
        root.scrollTop = root.scrollHeight;
      }
      function clearChat(){
        const root = document.getElementById('chatHistory');
        if(root){ root.innerHTML = ''; }
        seenTimelineIds.clear();
      }
      function appendFromTimelineEvent(ev){
        if(!ev || !ev.id){ return; }
        if(seenTimelineIds.has(ev.id)){ return; }
        seenTimelineIds.add(ev.id);
        const kind = String(ev.kind || 'system');
        
        if (kind === 'tool' || kind === 'status' || kind === 'system') {
          pushTrace(ev.content || "");
          return;
        }

        let lane = 'system';
        if(kind === 'user'){ lane = 'user'; }
        else if(kind === 'assistant'){ lane = 'assistant'; }
        else if(kind === 'stderr'){ lane = 'stderr'; }
        
        appendChat(lane, ev.content || '');
        if(kind === 'assistant' || kind === 'stderr'){
          agentMetrics.outputChars += (ev.content || '').length;
          agentMetrics.chunkCount += 1;
        }
        refreshMetrics();
      }
      function loadHistoryIntoPanels(messages){
        clearChat();
        thinkingEvents = [];
        lastTraceAtMs = Date.now();
        for(const msg of (messages || [])){
          const role = String(msg.role || 'entry').toLowerCase();
          
          if (role === 'tool' || role === 'status' || role === 'system') {
            pushTrace(msg.content || "");
            continue;
          }

          let lane = 'assistant';
          if(role === 'user' || role.includes('user') || role.includes('human')){
            lane = 'user';
          } else if(role === 'stderr' || role.includes('stderr') || role.includes('error')){
            lane = 'stderr';
          }

          appendChat(lane, msg.content || '');
        }
        const thinkingBlock = document.getElementById('agentThinking');
        if(thinkingEvents.length === 0){
          thinkingBlock.textContent = 'No thinking trace found in this session history.';
        }
      }
      function updateResumeSelect(rows){
        cachedSessionRows = Array.isArray(rows) ? rows : [];
        const select = document.getElementById('agentSessionSelect');
        if(!select){ return; }
        const prev = selectedResumeSessionId || select.value || '';
        const options = ['<option value="">(new session)</option>']
          .concat(cachedSessionRows.map((s) => {
            const label = '[' + (s.updatedAt || '').replace('T',' ').slice(0,19) + '] ' + String(s.id || '').slice(0,8) + '  ' + (s.preview || '');
            return '<option value="' + s.id + '">' + label.replace(/"/g, '&quot;') + '</option>';
          }));
        select.innerHTML = options.join('');
        const nextValue = cachedSessionRows.some((s) => s.id === prev) ? prev : '';
        select.value = nextValue;
        selectedResumeSessionId = nextValue || null;
      }
      function updateArgsResume(id){
        // Intentionally no-op so optional args remain fully user-controlled.
        // Resume routing is applied internally when building the request payload.
        void id;
      }
      function startFreshSession(){
        selectedResumeSessionId = null;
        const select = document.getElementById('agentSessionSelect');
        if(select){ select.value = ''; }
        updateArgsResume(null);
        appendChat('system', 'Switched to new session mode.');
      }
      function traceNow(){
        const d = new Date();
        return d.toTimeString().slice(0,8);
      }
      function pushTrace(line){
        if(!line){ return; }
        thinkingEvents.push('[' + traceNow() + '] ' + line);
        if(thinkingEvents.length > 120){
          thinkingEvents = thinkingEvents.slice(-120);
        }
        const block = document.getElementById('agentThinking');
        block.textContent = thinkingEvents.join('\\n');
        block.scrollTop = block.scrollHeight;
        lastTraceAtMs = Date.now();
      }

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
      if(EMBED_MODE){
        const topbar = document.querySelector('.topbar');
        if(topbar){ topbar.style.display = 'none'; }
      }
      async function pollAgent(){
        if(!activeSessionId){ return; }
        const res = await fetch(withToken('/api/agent/' + activeSessionId)).then(r=>r.json());
        if(!res.ok){ return; }
        const s = res.session;
        document.getElementById('agentSessionInfo').textContent = 'session=' + s.id + ' status=' + s.status + (s.exitCode !== undefined ? (' exit=' + s.exitCode) : '');
        document.getElementById('agentStatusBadge').textContent = s.status;
        agentMetrics.outputChars = (s.output || '').length + (s.errorOutput || '').length;
        refreshMetrics();
        const streamDead = !streamSource || streamSource.readyState !== 1;
        if(streamDead && Array.isArray(s.events)){
          for(const ev of s.events){
            appendFromTimelineEvent(ev);
          }
        }
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
        streamSource.addEventListener('timeline', (evt) => {
          try{
            const data = JSON.parse(evt.data || '{}');
            if(data.event){
              appendFromTimelineEvent(data.event);
            }
          }catch(_e){}
        });
        streamSource.addEventListener('status', (evt) => {
          const data = JSON.parse(evt.data || '{}');
          document.getElementById('agentSessionInfo').textContent = 'session=' + sessionId + ' status=' + (data.status || 'running') + (data.exitCode !== undefined ? (' exit=' + data.exitCode) : '');
          document.getElementById('agentStatusBadge').textContent = data.status || 'running';
          refreshMetrics();
        });
        streamSource.addEventListener('done', () => {
          pushTrace('stream completed');
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
          appendChat('system', 'Prompt is required.');
          return;
        }
        const continueMode = document.getElementById('continueMode').checked;
        const select = document.getElementById('agentSessionSelect');
        const pickedSession = (select?.value || selectedResumeSessionId || '').trim();
        const resumeSessionId = continueMode ? (pickedSession || selectedResumeSessionId || activeSessionId || '') : '';
        const baseArgs = (document.getElementById('agentArgs').value || '').trim();
        const cleanedArgs = baseArgs.replace(/(?:^|\s)--resume\s+\S+/g, '').trim();
        const effectiveArgs = resumeSessionId
          ? (cleanedArgs ? cleanedArgs + ' --resume ' + resumeSessionId : '--resume ' + resumeSessionId)
          : cleanedArgs;
        const payload = {
          prompt,
          args: effectiveArgs,
          modelPreference: document.getElementById('agentModelPref').value,
          autonomyMode: document.getElementById('autonomyMode').checked,
          sessionId: resumeSessionId || undefined
        };
        const res = await fetch(withToken('/api/agent/start'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(r=>r.json());
        if(!res.ok){
          appendChat('system', 'Failed to start: ' + JSON.stringify(res));
          return;
        }
        activeSessionId = res.sessionId;
        if(continueMode){
          selectedResumeSessionId = activeSessionId;
        }
        clearChat();
        thinkingEvents = [];
        lastTraceAtMs = Date.now();
        document.getElementById('agentThinking').textContent = '';
        pushTrace('session started');
        document.getElementById('agentStatusBadge').textContent = 'running';
        document.getElementById('agentSessionInfo').textContent = 'session=' + activeSessionId + ' status=running';
        agentMetrics = {
          startedAtMs: Date.now(),
          promptChars: prompt.length,
          outputChars: 0,
          chunkCount: 0,
        };
        refreshMetrics();
        if(pollTimer){ clearInterval(pollTimer); }
        pollTimer = setInterval(pollAgent, 1000);
        attachStream(activeSessionId);
        pollAgent();
        setTimeout(refreshSessions, 500);
      }
      function appendPrompt(text){
        const area = document.getElementById('agentPrompt');
        const current = area.value.trim();
        area.value = current ? (current + "\\n\\n" + text) : text;
        area.focus();
      }
      function clearPrompt(){
        const area = document.getElementById('agentPrompt');
        area.value = '';
        area.focus();
      }
      async function refreshSessions(){
        const data = await fetch(withToken('/api/sessions?limit=25')).then(r=>r.json());
        document.getElementById('sessionDirInfo').textContent = 'dir: ' + (data.dir || '(unknown)');
        updateResumeSelect(data.sessions || []);
        const rows = (data.sessions || []).map((s, idx) =>
          '<button class="entry sync-session" data-session-id="' + s.id + '"' + (idx===0 ? ' style="border:1px solid var(--accent)"' : '') + '>' +
          '[' + (s.updatedAt || '').replace('T',' ').slice(0,19) + '] ' + s.id.slice(0,8) + '  ' + (s.preview || '') +
          '</button>'
        ).join('');
        document.getElementById('sessionList').innerHTML = rows || '<span class="muted small">No transcript sessions found yet.</span>';
        document.querySelectorAll('.sync-session').forEach((el) => {
          el.onclick = () => loadSession(el.getAttribute('data-session-id'));
        });
        if(selectedResumeSessionId){ await loadSession(selectedResumeSessionId); }
      }
      async function loadSession(id){
        if(!id){ return; }
        selectedSyncedSession = id;
        selectedResumeSessionId = id;
        activeSessionId = id;
        updateArgsResume(id);
        const select = document.getElementById('agentSessionSelect');
        if(select){ select.value = id; }
        const data = await fetch(withToken('/api/sessions/' + id)).then(r=>r.json());
        selectedSyncedMessages = data.messages || [];
        loadHistoryIntoPanels(selectedSyncedMessages);
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
        selectedResumeSessionId = selectedSyncedSession;
        const select = document.getElementById('agentSessionSelect');
        if(select){ select.value = selectedSyncedSession; }
        document.getElementById('result').textContent = 'Resume target set to session: ' + selectedSyncedSession;
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
      refreshDir();
      refreshSessions();
      document.querySelectorAll('.tab').forEach((tab) => {
        const targetView = tab.getAttribute('data-view');
        if(!targetView){ return; }
        tab.onclick = () => setView(targetView);
      });
      const mainGridBtn = document.getElementById('mainGridBtn');
      if(mainGridBtn){
        mainGridBtn.addEventListener('click', (evt) => {
          evt.preventDefault();
          openMainGrid();
        });
      }
      const sessionSelect = document.getElementById('agentSessionSelect');
      if(sessionSelect){
        sessionSelect.addEventListener('change', () => {
          const value = sessionSelect.value || '';
          selectedResumeSessionId = value || null;
          updateArgsResume(selectedResumeSessionId);
          if(value){
            loadSession(value);
          }
        });
      }
      document.getElementById('agentPrompt').addEventListener('keydown', (evt) => {
        const withCmd = evt.metaKey || evt.ctrlKey;
        if(withCmd && evt.key === 'Enter'){
          evt.preventDefault();
          startAgentRun();
        }
      });
      setView(INITIAL_VIEW);
      setInterval(refreshMetrics, 1000);
      setInterval(refresh, 3000);
    </script>
  </body>
</html>`);
      return;
    }

    res.statusCode = 404;
    res.end("Not found");
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`);
    if (!url.pathname.startsWith("/ws/main/")) {
      socket.destroy();
      return;
    }
    if (!isAuthorized(url)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    mainPaneWs.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      mainPaneWs.emit("connection", ws, req);
    });
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
