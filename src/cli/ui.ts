import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

export async function runUiServer(baseConfig: WinnowConfig, options: UiOptions): Promise<void> {
  let config = { ...baseConfig };
  const sessions = new Map<string, AgentSession>();

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
      session.output += buf.toString("utf8");
    });
    child.stderr?.on("data", (buf: Buffer) => {
      session.errorOutput += buf.toString("utf8");
    });

    child.stdin?.write(`${payload.prompt}\n`);
    child.stdin?.end();

    child.on("close", (code: number | null) => {
      session.exitCode = code ?? 1;
      session.status = session.exitCode === 0 ? "done" : "error";
      session.endedAt = new Date().toISOString();
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
    <title>Winnow UI</title>
    <style>
      body{font-family:system-ui,Arial,sans-serif;max-width:960px;margin:20px auto;padding:0 16px}
      .row{display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap}
      input,select,button{padding:6px 8px}
      pre{background:#111;color:#ddd;padding:12px;border-radius:8px;max-height:300px;overflow:auto}
      .card{border:1px solid #ddd;border-radius:8px;padding:12px;margin:12px 0}
    </style>
  </head>
  <body>
    <h1>Winnow UI</h1>
    <div class="card">
      <h3>Status</h3>
      <pre id="status">Loading...</pre>
    </div>
    <div class="card">
      <h3>Controls</h3>
      <div class="row">
        <label>Backend</label>
        <select id="backend"><option value="ollama">ollama</option><option value="deepseek_api">deepseek_api</option></select>
        <button onclick="saveBackend()">Save</button>
      </div>
      <div class="row">
        <label>Model</label>
        <input id="model" placeholder="deepseek-v4-flash" />
        <button onclick="saveModel()">Save</button>
      </div>
      <div class="row">
        <label>Glossary</label>
        <input id="glossary" style="width:480px" placeholder="PR:拉取请求,branch:分支" />
        <button onclick="saveGlossary()">Save</button>
      </div>
      <div class="row">
        <button onclick="setMode('zh')">Mode: ZH</button>
        <button onclick="setMode('dual')">Mode: Dual</button>
        <button onclick="setMode('raw')">Mode: Raw</button>
      </div>
      <pre id="result"></pre>
    </div>
    <div class="card">
      <h3>Agent Console (Cursor Native)</h3>
      <p>Runs <code>cursor-agent</code> directly with translation disabled. Uses Cursor-side model preference (auto or composer).</p>
      <div class="row">
        <label>Model Pref</label>
        <select id="agentModelPref">
          <option value="auto">auto</option>
          <option value="composer">composer</option>
        </select>
      </div>
      <div class="row">
        <label>Cursor Args</label>
        <input id="agentArgs" style="width:560px" placeholder="optional args passed to cursor-agent" />
      </div>
      <div class="row">
        <textarea id="agentPrompt" style="width:100%;min-height:120px;padding:8px" placeholder="Describe the coding task for Cursor agent..."></textarea>
      </div>
      <div class="row">
        <button onclick="startAgentRun()">Run Agent</button>
        <span id="agentSessionInfo"></span>
      </div>
      <pre id="agentOutput">No run yet.</pre>
    </div>
    <div class="card">
      <h3>Recent Logs</h3>
      <pre id="logs">Loading...</pre>
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
        pollAgent();
      }
      refresh();
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
