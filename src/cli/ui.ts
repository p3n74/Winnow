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
