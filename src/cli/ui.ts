import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { WinnowConfig } from "../config/schema.js";
import { getStatusSnapshot } from "./status.js";
import { saveProjectProfile } from "../config/projectProfile.js";

type UiOptions = {
  port: number;
  openBrowser: boolean;
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

export async function runUiServer(baseConfig: WinnowConfig, options: UiOptions): Promise<void> {
  let config = { ...baseConfig };
  const sessions = new Map<string, AgentSession>();
  const streamClients = new Map<string, Set<SessionStreamClient>>();

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
    });
    child.stderr?.on("data", (buf: Buffer) => {
      const chunk = buf.toString("utf8");
      session.errorOutput += chunk;
      pushStreamEvent(id, "stderr", { chunk, sessionId: id });
    });

    child.stdin?.write(`${payload.prompt}\n`);
    child.stdin?.end();

    child.on("close", (code: number | null) => {
      session.exitCode = code ?? 1;
      session.status = session.exitCode === 0 ? "done" : "error";
      session.endedAt = new Date().toISOString();
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
      .tab{padding:5px 10px;border:1px solid var(--line);border-radius:6px;background:var(--panel);font-size:12px;color:var(--muted)}
      .tab.active{color:var(--text);border-color:var(--accent)}
      .body{flex:1;display:grid;grid-template-columns:38% 62%;gap:8px;padding:8px;min-height:0}
      .leftCol,.rightCol{display:grid;gap:8px;min-height:0}
      .leftCol{grid-template-rows:32% 18% 22% 28%}
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
        <div class="tab">OS default</div>
        <div class="tab active">Winnow UI</div>
        <div class="tab">Cursor Agent</div>
        <div class="tab">Settings</div>
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
            <textarea id="agentPrompt" placeholder="Describe the coding task for Cursor agent..."></textarea>
            <div class="small muted" style="margin:6px 0">Current git diff</div>
            <pre id="workspaceDiff">Loading...</pre>
          </div>
        </div>
      </div>
    </div>
    <script>
      async function refresh(){
        const state = await fetch('/api/state').then(r=>r.json());
        document.getElementById('status').textContent = JSON.stringify(state,null,2);
        document.getElementById('backend').value = state.backend;
        document.getElementById('model').value = state.model;
        const logs = await fetch('/api/logs?limit=60').then(r=>r.json());
        document.getElementById('logs').textContent = (logs.logs || []).join('\\n') || 'No logs yet';
      }
      let currentDir = '';
      async function refreshDir(path){
        const url = path ? ('/api/fs/list?path=' + encodeURIComponent(path)) : '/api/fs/list';
        const data = await fetch(url).then(r=>r.json());
        currentDir = data.cwd;
        document.getElementById('dirCwd').textContent = data.cwd;
        const parentBtn = data.parent ? '<button class="entry" onclick="refreshDir(\\'' + data.parent.replace(/\\/g,'\\\\').replace(/'/g,"\\'") + '\\')">[..]</button>' : '';
        const rows = (data.entries || []).map((e) => {
          const icon = e.type === 'dir' ? '[D]' : '[F]';
          const safePath = e.path.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
          if(e.type === 'dir'){
            return '<button class="entry" onclick="refreshDir(\\'' + safePath + '\\')">' + icon + ' ' + e.name + '</button>';
          }
          return '<button class="entry" onclick="previewFile(\\'' + safePath + '\\')">' + icon + ' ' + e.name + '</button>';
        }).join('');
        document.getElementById('dirEntries').innerHTML = parentBtn + rows;
      }
      async function goParent(){
        if(!currentDir){ return; }
        await refreshDir(currentDir + '/..');
      }
      async function previewFile(path){
        const data = await fetch('/api/fs/preview?path=' + encodeURIComponent(path)).then(r=>r.json());
        document.getElementById('dirPreviewPath').textContent = path;
        document.getElementById('dirPreview').textContent = data.content || '';
      }
      async function refreshWorkspace(){
        const ws = await fetch('/api/workspace').then(r=>r.json());
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
        const res = await fetch('/api/workspace/stage',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({files})
        }).then(r=>r.json());
        document.getElementById('result').textContent = JSON.stringify(res,null,2);
        await refreshWorkspace();
      }
      async function post(data){
        const res = await fetch('/api/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json());
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
      async function pollAgent(){
        if(!activeSessionId){ return; }
        const res = await fetch('/api/agent/' + activeSessionId).then(r=>r.json());
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
        streamSource = new EventSource('/api/agent/' + sessionId + '/stream');
        streamSource.addEventListener('stdout', (evt) => {
          const data = JSON.parse(evt.data || '{}');
          const out = document.getElementById('agentOutput');
          out.textContent = (out.textContent === 'Running...' ? '' : out.textContent) + (data.chunk || '');
        });
        streamSource.addEventListener('stderr', (evt) => {
          const data = JSON.parse(evt.data || '{}');
          const out = document.getElementById('agentOutput');
          const prefix = out.textContent && !out.textContent.endsWith('\n') ? '\n' : '';
          out.textContent = (out.textContent === 'Running...' ? '' : out.textContent) + prefix + '[stderr]\n' + (data.chunk || '');
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
        const res = await fetch('/api/agent/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(r=>r.json());
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
      refresh();
      refreshWorkspace();
      refreshDir();
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
    server.listen(options.port, "127.0.0.1", () => resolve());
  });

  const url = `http://127.0.0.1:${options.port}`;
  process.stdout.write(`[winnow-ui] running at ${url}\n`);
  process.stdout.write("[winnow-ui] press Ctrl+C to stop\n");
  if (options.openBrowser) {
    maybeOpenBrowser(url);
  }
}
