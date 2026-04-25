import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { appendFile, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { accessSync, constants as fsConstants, createReadStream, readFileSync } from "node:fs";
import { arch, cpus, freemem, homedir, loadavg, networkInterfaces, platform, totalmem, uptime } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import pty from "node-pty";
import { loadConfigFromEnv, WinnowConfig } from "../config/schema.js";
import { getStatusSnapshot } from "./status.js";
import {
  applyProjectProfile,
  loadProjectProfile,
  saveProjectProfile,
} from "../config/projectProfile.js";
import { loadDotenvFromDisk, readDotenvFile, WINNOW_DOTENV_SPECS, writeDotenvFileFull } from "../config/dotenvFile.js";
import { buildAgentWindowPageHtml } from "./agentWindowHtml.js";
import {
  readProjectDocsIndex,
  rebuildAndWriteProjectDocsIndex,
  resolveDocFilePath,
} from "./projectDocsIndex.js";
import { listProjects, registerProject } from "../config/projects.js";
import {
  finalizeRun,
  queryFilters,
  queryLastAgentRun,
  queryRuns,
  querySummary,
  queryTimeseries,
  recordRunUsage,
  upsertRunStart,
  usageDbStatus,
} from "../data/usageStore.js";
import { buildDiskDashboard } from "../data/diskSnapshotService.js";
import {
  ensureCursorWorkspaceLayout,
  ensureCursorWorkspaceLayoutSync,
} from "../cursor/bootstrapCursorWorkspace.js";
import {
  agentTranscriptDirForWorkspaceRoot,
  findCursorTranscriptJsonlPath,
  getTranscriptDir,
  listCursorSessions,
  listCursorSessionsForWorkspaceRoot,
  SessionSummary,
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
  /** Pane 2 is the embed workspace (iframe); the shell PTY is opened only from the Workspace↔Terminal tab in that pane. */
  "2": "",
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
  id?: string;
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
      :root {
        --bg: #000000;
        --panel: #000000;
        --panel2: #0a0a0a;
        --line: rgba(34, 211, 238, 0.32);
        --line-faint: rgba(34, 211, 238, 0.12);
        --text: #7dd3fc;
        --text-strong: #22d3ee;
        --text-neon: #5eead4;
        --muted: rgba(125, 211, 252, 0.58);
        --accent: #22d3ee;
        --accent-hover: #67e8f9;
        --red-pastel: #fecaca;
        --red-neon: #f87171;
        --danger: #f87171;
        --success: #2dd4bf;
        --radius: 8px;
        --radius-sm: 6px;
        --shadow: none;
        --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        background: var(--bg);
        color: var(--text);
        font-family: var(--font-sans);
        font-size: 13px;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
      }
      .workspace { display: grid; grid-template-rows: 48px 1fr; height: 100vh; width: 100%; }
      .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 16px;
        border-bottom: 1px solid var(--line);
        background: var(--panel);
        box-shadow: none;
        z-index: 10;
      }
      .toolbarLeft, .toolbarRight { display: flex; gap: 12px; align-items: center; }
      .brand { font-size: 13px; font-weight: 700; color: var(--text-neon); }
      .chip {
        font-size: 11px;
        font-weight: 600;
        color: var(--muted);
        border: 1px solid var(--line);
        padding: 2px 8px;
        border-radius: 99px;
        background: var(--bg);
        letter-spacing: 0.05em;
      }
      .back {
        border: 1px solid transparent;
        background: transparent;
        color: var(--muted);
        padding: 6px 12px;
        border-radius: var(--radius-sm);
        font-size: 13px;
        font-weight: 500;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        transition: all 0.2s;
      }
      .back:hover { background: var(--line-faint); color: var(--text-neon); }
      .root { display: grid; grid-template-columns: 45fr 55fr; gap: 16px; padding: 16px; min-width: 0; min-height: 0; }
      .left { display: grid; grid-template-rows: 1fr 1fr; gap: 16px; min-width: 0; min-height: 0; }
      .leftBottom { display: grid; grid-template-columns: 40fr 60fr; gap: 16px; min-width: 0; min-height: 0; }
      .leftBottomLeft { display: grid; grid-template-rows: 60fr 40fr; gap: 16px; min-width: 0; min-height: 0; }
      .pane {
        min-width: 0;
        min-height: 0;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        overflow: hidden;
        box-shadow: var(--shadow);
      }
      .paneInner { width: 100%; height: 100%; display: grid; grid-template-rows: 38px 1fr; }
      .paneHead {
        border-bottom: 1px solid var(--line);
        color: var(--muted);
        font-size: 12px;
        padding: 0 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--panel);
      }
      .paneTitle { display: flex; align-items: center; gap: 8px; color: var(--text-strong); font-weight: 500; }
      .paneCmd {
        font-size: 10px;
        color: var(--muted);
        border: 1px solid var(--line);
        padding: 2px 6px;
        border-radius: 99px;
        background: var(--bg);
        font-family: var(--font-mono);
      }
      .reconnect {
        border: 1px solid var(--line);
        background: var(--bg);
        color: var(--text);
        border-radius: var(--radius-sm);
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }
      .reconnect:hover { border-color: var(--line); background: var(--panel2); color: var(--text-strong); }
      .term { width: 100%; height: 100%; overflow: hidden; background: var(--bg); padding: 4px; }
      .cursorHost { width: 100%; height: 100%; border: 0; background: var(--bg); }
      .paneTabs { display: flex; gap: 4px; align-items: center; }
      .paneTab {
        border: 1px solid var(--line);
        background: var(--bg);
        color: var(--muted);
        border-radius: var(--radius-sm);
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        font-family: var(--font-sans);
        transition: all 0.15s;
      }
      .paneTab:hover { color: var(--text-strong); background: var(--panel2); }
      .paneTab.paneTabActive {
        border-color: var(--line);
        color: var(--text-neon);
        background: var(--panel2);
        box-shadow: 0 0 0 1px var(--line-faint);
      }
      .pane2Body {
        position: relative;
        min-width: 0;
        min-height: 0;
        width: 100%;
        height: 100%;
      }
      .pane2View {
        position: absolute;
        inset: 0;
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .pane2View.isHidden {
        visibility: hidden;
        pointer-events: none;
        z-index: 0;
      }
      .pane2View:not(.isHidden) { z-index: 1; }
      .pane2View .cursorHost { flex: 1; min-height: 0; width: 100%; border: 0; background: var(--bg); }
      .pane2DocsRoot { padding: 0 10px 10px; gap: 8px; }
      .docsToolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        padding-top: 6px;
      }
      .docsSelect {
        flex: 1;
        min-width: 160px;
        max-width: 100%;
        background: var(--bg);
        border: 1px solid var(--line);
        color: var(--text);
        border-radius: var(--radius-sm);
        padding: 6px 8px;
        font-size: 12px;
      }
      .docsHint { margin: 0; font-size: 11px; flex-shrink: 0; }
      .docsBody {
        position: relative;
        flex: 1;
        min-height: 0;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        background: var(--bg);
        overflow: hidden;
      }
      .docsMdRendered {
        position: absolute;
        inset: 0;
        overflow: auto;
        padding: 14px 18px;
        font-size: 13px;
        line-height: 1.55;
        color: var(--text);
      }
      .docsMdRendered h1, .docsMdRendered h2, .docsMdRendered h3 { color: var(--text-neon); margin: 1.1em 0 0.45em; }
      .docsMdRendered h1 { font-size: 1.35rem; }
      .docsMdRendered pre, .docsMdRendered code {
        font-family: var(--font-mono);
        background: var(--panel2);
        border: 1px solid var(--line-faint);
        border-radius: 4px;
      }
      .docsMdRendered pre { padding: 10px; overflow: auto; font-size: 12px; }
      .docsMdRendered code { padding: 1px 4px; font-size: 12px; }
      .docsMdRendered pre code { border: 0; padding: 0; background: transparent; }
      .docsMdRendered a { color: var(--accent-hover); }
      .docsPdfViewer {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border: 0;
        background: #111;
      }
      .docsMdRendered.isHidden,
      .docsPdfViewer.isHidden {
        display: none !important;
      }
      @media (max-width: 1200px) {
        .root { grid-template-columns: 1fr; grid-template-rows: 56% 44%; }
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
          <span class="chip">2 agent · shell · docs</span>
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
          <div class="paneHead">
            <span class="paneTitle">2 Companion <span class="paneCmd" id="pane2ModeChip">winnow-agent-ui</span></span>
            <div style="display:flex;align-items:center;gap:10px">
              <div class="paneTabs" role="tablist" aria-label="Agent UI, docs, and system shell">
                <button type="button" class="paneTab paneTabActive" role="tab" aria-selected="true" data-pane2-tab="workspace" id="pane2TabWorkspace">Agent</button>
                <button type="button" class="paneTab" role="tab" aria-selected="false" data-pane2-tab="terminal" id="pane2TabTerminal">Shell</button>
                <button type="button" class="paneTab" role="tab" aria-selected="false" data-pane2-tab="docs" id="pane2TabDocs">Docs</button>
              </div>
              <button type="button" class="reconnect" id="reconnectPane2" data-pane="2" hidden>Reconnect</button>
            </div>
          </div>
          <div class="pane2Body">
            <div id="pane2Workspace" class="pane2View">
              <iframe
                class="cursorHost"
                title="Cursor Panel"
                src="${token ? `/agent?token=${encodeURIComponent(token)}&embed=1` : "/agent?embed=1"}"
              ></iframe>
            </div>
            <div id="pane2TerminalWrap" class="pane2View isHidden" aria-hidden="true">
              <div id="pane2term" class="term"></div>
            </div>
            <div id="pane2Docs" class="pane2View isHidden pane2DocsRoot" aria-hidden="true">
              <div class="docsToolbar">
                <button type="button" class="reconnect" id="btnDocsReindex">Refresh index</button>
                <select id="docsFileSelect" class="docsSelect" aria-label="Markdown and PDF files">
                  <option value="">(select file)</option>
                </select>
              </div>
              <p id="docsHint" class="docsHint muted">Index is built under <code>.winnow/docs-index.json</code>. Use Refresh index after adding files.</p>
              <div class="docsBody">
                <article id="docsMdRendered" class="docsMdRendered isHidden"></article>
                <iframe id="docsPdfViewer" class="docsPdfViewer isHidden" title="PDF preview"></iframe>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.7/dist/purify.min.js"></script>
    <script src="https://unpkg.com/@xterm/xterm/lib/xterm.js"></script>
    <script src="https://unpkg.com/@xterm/addon-fit/lib/addon-fit.js"></script>
    <script>
      const AUTH_TOKEN = ${JSON.stringify(token ?? "")};
      const panes = ["1","3","4","5"];
      const paneState = new Map();
      const PANE2_ID = "2";
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
          theme:{background:"#000000",foreground:"#7dd3fc",cursor:"#5eead4", selectionBackground: "rgba(34, 211, 238, 0.28)"}
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
      function openPane2Terminal(){
        const mount = document.getElementById("pane2term");
        if(!mount || paneState.has(PANE2_ID)){ return; }
        mount.innerHTML = "";
        const term = new Terminal({
          cursorBlink:true,
          fontSize:12,
          theme:{background:"#000000",foreground:"#7dd3fc",cursor:"#5eead4", selectionBackground: "rgba(34, 211, 238, 0.28)"}
        });
        const fit = new FitAddon.FitAddon();
        term.loadAddon(fit);
        term.open(mount);
        fit.fit();
        const ws = new WebSocket(wsPath(PANE2_ID));
        paneState.set(PANE2_ID,{term,fit,ws});
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
        const p2 = paneState.get(PANE2_ID);
        if(p2){
          p2.fit.fit();
          if(p2.ws.readyState===WebSocket.OPEN){
            p2.ws.send(JSON.stringify({type:"resize",cols:p2.term.cols,rows:p2.term.rows}));
          }
        }
      }
      function setPane2Tab(mode){
        const wsEl = document.getElementById("pane2Workspace");
        const tsEl = document.getElementById("pane2TerminalWrap");
        const docEl = document.getElementById("pane2Docs");
        const chip = document.getElementById("pane2ModeChip");
        const tw = document.getElementById("pane2TabWorkspace");
        const tt = document.getElementById("pane2TabTerminal");
        const td = document.getElementById("pane2TabDocs");
        const recon = document.getElementById("reconnectPane2");
        const isWs = mode === "workspace";
        const isTerm = mode === "terminal";
        const isDoc = mode === "docs";
        if(wsEl && tsEl && docEl){
          wsEl.classList.toggle("isHidden", !isWs);
          tsEl.classList.toggle("isHidden", !isTerm);
          docEl.classList.toggle("isHidden", !isDoc);
          wsEl.setAttribute("aria-hidden", isWs ? "false" : "true");
          tsEl.setAttribute("aria-hidden", isTerm ? "false" : "true");
          docEl.setAttribute("aria-hidden", isDoc ? "false" : "true");
        }
        if(chip){
          chip.textContent = isTerm ? "login shell" : isDoc ? "md · pdf" : "winnow-agent-ui";
        }
        if(tw && tt && td){
          tw.classList.toggle("paneTabActive", isWs);
          tt.classList.toggle("paneTabActive", isTerm);
          td.classList.toggle("paneTabActive", isDoc);
          tw.setAttribute("aria-selected", isWs.toString());
          tt.setAttribute("aria-selected", isTerm.toString());
          td.setAttribute("aria-selected", isDoc.toString());
        }
        if(recon){ recon.hidden = !isTerm; }
        if(isTerm){
          openPane2Terminal();
          requestAnimationFrame(()=>{
            resizeAll();
            const cur = paneState.get(PANE2_ID);
            if(cur && cur.term){ cur.term.focus(); }
          });
        }
        if(isDoc){
          void refreshDocsIndex(false);
        }
      }
      async function refreshDocsIndex(force){
        const sel = document.getElementById("docsFileSelect");
        const hint = document.getElementById("docsHint");
        if(!sel){ return; }
        const prev = sel.value || "";
        try{
          const url = withToken("/api/workspace/docs-index" + (force ? "?refresh=1" : ""));
          const data = await fetch(url).then((r)=>r.json());
          if(!data.ok){
            if(hint){ hint.textContent = data.error || "Failed to load index"; }
            return;
          }
          const files = (data.index && data.index.files) ? data.index.files : [];
          const opts = ['<option value="">(select file)</option>'].concat(
            files.map((f)=>{
              const safeLabel = "[" + f.kind + "] " + f.relPath.replace(/&/g, "&amp;").replace(/</g, "&lt;");
              return '<option value="' + encodeURIComponent(f.relPath) + '">' + safeLabel + "</option>";
            })
          );
          sel.innerHTML = opts.join("");
          if(prev && files.some((f)=>f.relPath === prev)){
            sel.value = encodeURIComponent(prev);
          }
          if(hint){
            hint.textContent = "Indexed " + files.length + " file(s) at " + (data.index.scannedAt || "").replace("T"," ").slice(0,19) + " · .winnow/docs-index.json";
          }
        } catch(err){
          if(hint){ hint.textContent = (err && err.message) ? err.message : String(err); }
        }
      }
      function clearDocViewer(){
        const md = document.getElementById("docsMdRendered");
        const pdf = document.getElementById("docsPdfViewer");
        if(md){
          md.innerHTML = "";
          md.classList.add("isHidden");
        }
        if(pdf){
          pdf.src = "about:blank";
          pdf.classList.add("isHidden");
        }
      }
      async function loadSelectedDoc(relPath){
        const md = document.getElementById("docsMdRendered");
        const pdf = document.getElementById("docsPdfViewer");
        const hint = document.getElementById("docsHint");
        if(!relPath || !md || !pdf){
          clearDocViewer();
          return;
        }
        const lower = relPath.toLowerCase();
        if(lower.endsWith(".pdf")){
          md.classList.add("isHidden");
          md.innerHTML = "";
          pdf.classList.remove("isHidden");
          pdf.src = withToken("/api/workspace/doc?path=" + encodeURIComponent(relPath));
          return;
        }
        pdf.src = "about:blank";
        pdf.classList.add("isHidden");
        md.classList.remove("isHidden");
        try{
          const res = await fetch(withToken("/api/workspace/doc?path=" + encodeURIComponent(relPath))).then((r)=>r.json());
          if(!res.ok || res.kind !== "md"){
            md.innerHTML = "<p>" + (res.error || "Failed to load markdown") + "</p>";
            return;
          }
          const raw = typeof marked !== "undefined" && marked.parse
            ? marked.parse(res.markdown || "", { mangle: false, headerIds: false })
            : "<pre>" + String(res.markdown || "").replace(/</g, "&lt;") + "</pre>";
          const clean = typeof DOMPurify !== "undefined" && DOMPurify.sanitize ? DOMPurify.sanitize(raw) : raw;
          md.innerHTML = clean;
        } catch(err){
          md.innerHTML = "<p>" + ((err && err.message) ? err.message : String(err)) + "</p>";
        }
        if(hint){ hint.textContent = relPath; }
      }
      document.getElementById("pane2TabWorkspace")?.addEventListener("click",()=>setPane2Tab("workspace"));
      document.getElementById("pane2TabTerminal")?.addEventListener("click",()=>setPane2Tab("terminal"));
      document.getElementById("pane2TabDocs")?.addEventListener("click",()=>setPane2Tab("docs"));
      document.getElementById("btnDocsReindex")?.addEventListener("click",()=>{ void refreshDocsIndex(true); });
      function decodeDocPath(raw){
        if(!raw){ return ""; }
        try{ return decodeURIComponent(raw); } catch(_e){ return raw; }
      }
      document.getElementById("docsFileSelect")?.addEventListener("change",(e)=>{
        const t = e.target;
        const v = t && t.value ? decodeDocPath(t.value) : "";
        if(!v){ clearDocViewer(); return; }
        void loadSelectedDoc(v);
      });
      (function setupDockedBack(){
        const params = new URLSearchParams(location.search);
        const docked = params.get("dock") === "1" && window.parent !== window;
        const back = document.querySelector("a.back");
        if(!back || !docked){ return; }
        back.addEventListener("click", function(e){
          if(e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey){ return; }
          e.preventDefault();
          window.parent.postMessage({ type: "winnow-hide-main-grid" }, window.location.origin);
        });
      })();
      window.addEventListener("resize", resizeAll);
      panes.forEach((paneId)=>openPane(paneId));
      document.querySelectorAll(".reconnect").forEach((btn)=>{
        btn.addEventListener("click",()=>{
          const paneId = btn.getAttribute("data-pane");
          const current = paneState.get(paneId);
          if(current && current.ws){ current.ws.close(); }
          if(paneId === PANE2_ID){
            paneState.delete(PANE2_ID);
            openPane2Terminal();
            requestAnimationFrame(resizeAll);
          } else {
            openPane(paneId);
          }
        });
      });
      setTimeout(resizeAll, 120);
    </script>
  </body>
</html>`;
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

export async function runUiServer(baseConfig: WinnowConfig, options: UiOptions): Promise<void> {
  let config = { ...baseConfig };
  const winnowLaunchRoot = resolve(process.cwd());
  const uiWorkspace = { dir: winnowLaunchRoot };

  // Register current directory as a project
  await registerProject(winnowLaunchRoot);

  function expandUserPathSegment(raw: string): string {
    const t = raw.trim();
    if (t === "~") {
      return homedir();
    }
    if (t.startsWith("~/") || t.startsWith("~\\")) {
      return join(homedir(), t.slice(2));
    }
    return t;
  }

  function resolveUiPath(inputPath?: string): string {
    if (!inputPath?.trim()) {
      return uiWorkspace.dir;
    }
    const expanded = expandUserPathSegment(inputPath.trim());
    if (expanded.startsWith("/") || /^[A-Za-z]:[\\/]/.test(expanded)) {
      return resolve(expanded);
    }
    return resolve(uiWorkspace.dir, expanded);
  }

  async function applyWorkspaceDir(nextAbsolute: string, persist: boolean): Promise<string> {
    const resolved = resolve(nextAbsolute);
    const real = await realpath(resolved).catch(() => resolved);
    const info = await stat(real);
    if (!info.isDirectory()) {
      throw new Error(`Not a directory: ${real}`);
    }
    uiWorkspace.dir = real;
    await ensureCursorWorkspaceLayout(uiWorkspace.dir);
    if (persist) {
      config = { ...config, uiWorkspaceDir: real };
      await saveProjectProfile(config);
    }
    return real;
  }

  if (config.uiWorkspaceDir?.trim()) {
    try {
      await applyWorkspaceDir(expandUserPathSegment(config.uiWorkspaceDir), false);
    } catch {
      uiWorkspace.dir = winnowLaunchRoot;
    }
  }
  await ensureCursorWorkspaceLayout(uiWorkspace.dir);

  const cursorTranscriptDirForUi = (): string =>
    process.env.WINNOW_AGENT_TRANSCRIPTS_DIR?.trim()
      ? getTranscriptDir()
      : agentTranscriptDirForWorkspaceRoot(uiWorkspace.dir);

  async function readRecentLogEntries(logsDir: string, limit = 50): Promise<string[]> {
    try {
      const filePath = join(uiWorkspace.dir, logsDir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
      const content = await readFile(filePath, "utf8");
      const lines = content.trim().split("\n").filter(Boolean);
      return lines.slice(Math.max(0, lines.length - limit));
    } catch {
      return [];
    }
  }

  function runGitCommand(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return new Promise((resolvePromise) => {
      const child = spawn("git", args, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: uiWorkspace.dir,
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
        resolvePromise({ ok: false, stdout: "", stderr: error.message });
      });
      child.on("close", (code: number | null) => {
        resolvePromise({ ok: code === 0, stdout, stderr });
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

  async function listDirectory(dirPath?: string): Promise<{
    cwd: string;
    parent: string | null;
    entries: FileListEntry[];
  }> {
    const absolute = resolveUiPath(dirPath);
    const info = await stat(absolute);
    if (!info.isDirectory()) {
      throw new Error(`Not a directory: ${absolute}`);
    }
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

    const parentPath = resolve(absolute, "..");
    const parent = parentPath === absolute ? null : parentPath;
    return { cwd: absolute, parent, entries };
  }

  async function previewPath(pathValue?: string): Promise<{ path: string; content: string }> {
    const absolute = resolveUiPath(pathValue);
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
    return join(uiWorkspace.dir, ".winnow", "sessions");
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

  async function countSessionRecordJsonFiles(): Promise<number> {
    try {
      const names = await readdir(localSessionDir());
      return names.filter((n) => n.endsWith(".json") && n !== "index.json").length;
    } catch {
      return 0;
    }
  }

  /** Rebuild index rows for any `*.json` session record on disk that is missing from the index. */
  async function mergeSessionRecordsMissingFromIndex(index: LocalSessionIndexEntry[]): Promise<LocalSessionIndexEntry[]> {
    const byId = new Map(index.map((e) => [e.id, e]));
    let dir: string;
    try {
      dir = localSessionDir();
      const names = await readdir(dir);
      for (const name of names) {
        if (!name.endsWith(".json") || name === "index.json") {
          continue;
        }
        const id = name.slice(0, -".json".length);
        if (byId.has(id)) {
          continue;
        }
        try {
          const raw = await readFile(join(dir, name), "utf8");
          const record = JSON.parse(raw) as LocalSessionRecord;
          if (record.id !== id) {
            continue;
          }
          const entry: LocalSessionIndexEntry = {
            id,
            startedAt: record.startedAt,
            updatedAt: record.endedAt || record.startedAt,
            status: record.status,
            preview: (record.prompt || record.output || "").slice(0, 160),
            source: "winnow-local",
          };
          byId.set(id, entry);
        } catch {
          // skip corrupt or partial record
        }
      }
    } catch {
      return index;
    }
    return [...byId.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  /**
   * Serialize writes to `sessions/index.json`. Concurrent upserts each read+merge+write; without
   * ordering, two writers can both read the old index and the last write drops the other session.
   */
  let localSessionIndexWriteChain: Promise<void> = Promise.resolve();

  async function upsertLocalSessionIndex(entry: LocalSessionIndexEntry): Promise<void> {
    const run = async (): Promise<void> => {
      let current = await readLocalSessionIndex();
      if (current.length < (await countSessionRecordJsonFiles())) {
        current = await mergeSessionRecordsMissingFromIndex(current);
      }
      const next = [entry, ...current.filter((item) => item.id !== entry.id)]
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, 500);
      await writeLocalSessionIndex(next);
    };
    const job = localSessionIndexWriteChain.then(run, run);
    localSessionIndexWriteChain = job.catch(() => {
      /* keep queue alive; void callers must not strand later upserts */
    });
    await job.catch((err) => {
      process.stderr.write(`[winnow-ui] session index update failed: ${(err as Error).message}\n`);
    });
  }

  async function writeLocalSessionRecord(record: LocalSessionRecord): Promise<void> {
    await mkdir(localSessionDir(), { recursive: true });
    await writeFile(localSessionRecordPath(record.id), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  async function repairLocalSessionIndexIfStale(): Promise<void> {
    const run = async (): Promise<void> => {
      let current = await readLocalSessionIndex();
      if (current.length >= (await countSessionRecordJsonFiles())) {
        return;
      }
      current = await mergeSessionRecordsMissingFromIndex(current);
      await writeLocalSessionIndex(current.slice(0, 500));
    };
    const job = localSessionIndexWriteChain.then(run, run);
    localSessionIndexWriteChain = job.catch(() => {});
    await job.catch((err) => {
      process.stderr.write(`[winnow-ui] session index repair failed: ${(err as Error).message}\n`);
    });
  }

  async function listLocalSessions(limit = 20): Promise<SessionSummary[]> {
    await repairLocalSessionIndexIfStale();
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
        id: event.id,
        role: event.kind,
        content: event.content,
        timestamp: event.ts,
      }));
      return { id, messages };
    }
    const messages: SessionMessage[] = [
      { id: "init-prompt", role: "user", content: record.prompt, timestamp: record.startedAt },
    ];
    if (record.output?.trim()) {
      messages.push({ id: "init-output", role: "assistant", content: record.output, timestamp: record.endedAt });
    }
    if (record.errorOutput?.trim()) {
      messages.push({ id: "init-error", role: "stderr", content: record.errorOutput, timestamp: record.endedAt });
    }
    return { id, messages };
  }

  const sessions = new Map<string, AgentSession>();
  const streamClients = new Map<string, Set<SessionStreamClient>>();
  /** Live cursor-agent child processes keyed by session id (for cancel / stop). */
  const agentRunChildProcesses = new Map<string, ChildProcess>();
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
        cwd: uiWorkspace.dir,
        env: process.env as Record<string, string>,
      });
    } catch {
      for (const candidate of shellCandidates) {
        try {
          return pty.spawn(candidate, [], {
            name: "xterm-256color",
            cols: 120,
            rows: 36,
            cwd: uiWorkspace.dir,
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

  const startAgentSession = async (
    payload: AgentStartRequest,
    opts?: { signal?: AbortSignal },
  ): Promise<AgentSession> => {
    const signal = opts?.signal;
    const nativeConfig = forceCursorNativeConfig(config);
    const cursorExe = (nativeConfig.cursorCommand || "").trim() || "cursor-agent";
    const id = (payload.sessionId || "").trim() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseArgs = parseArgs(payload.args ?? "");
    const autonomyEnabled = payload.autonomyMode !== false;
    const args = ensureExecutionArgs(
      ensureModelArg(baseArgs, payload.modelPreference ?? "default"),
      autonomyEnabled,
      id
    );
    const existing = sessions.get(id);
    let session: AgentSession;

    if (existing) {
      session = {
        ...existing,
        status: "running",
        endedAt: undefined,
        error: undefined,
        command: cursorExe,
        args,
        startedAt: existing.startedAt || new Date().toISOString(),
        events: existing.events ?? [],
      };
    } else {
      // Try loading from disk
      let diskEvents: AgentEvent[] = [];
      let diskOutput = "";
      let diskErrorOutput = "";
      let diskStartedAt = new Date().toISOString();

      try {
        const recordPath = localSessionRecordPath(id);
        const content = readFileSync(recordPath, "utf8");
        const record = JSON.parse(content) as LocalSessionRecord;
        diskEvents = record.events || [];
        diskOutput = record.output || "";
        diskErrorOutput = record.errorOutput || "";
        diskStartedAt = record.startedAt || diskStartedAt;
      } catch {
        // New session or failed to read
      }

      session = {
        id,
        status: "running",
        startedAt: diskStartedAt,
        output: diskOutput,
        errorOutput: diskErrorOutput,
        command: cursorExe,
        args,
        events: diskEvents,
      };
    }

    sessions.set(id, session);
    const startedAt = session.startedAt;
    const modelPreference = payload.modelPreference ?? "default";
    const prompt = payload.prompt;

    const persistRecord = () =>
      writeLocalSessionRecord({
        id,
        projectRoot: uiWorkspace.dir,
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

    const abortOrThrow = (): void => {
      if (!signal?.aborted) {
        return;
      }
      session.status = "error";
      session.error = "Start cancelled";
      session.endedAt = new Date().toISOString();
      pushEvent("status", "Start cancelled.");
      void persistRecord();
      finalizeRun(id, "error", null, session.endedAt);
      void upsertLocalSessionIndex({
        id,
        startedAt,
        updatedAt: session.endedAt,
        status: "error",
        preview: prompt.slice(0, 160),
        source: "winnow-local",
      });
      closeStreamClients(id);
      sessions.delete(id);
      throw new DOMException("Start cancelled", "AbortError");
    };

    pushEvent("user", prompt);

    ensureCursorWorkspaceLayoutSync(uiWorkspace.dir);
    void persistRecord();
    void upsertLocalSessionIndex({
      id,
      startedAt,
      updatedAt: startedAt,
      status: session.status,
      preview: prompt.slice(0, 160),
      source: "winnow-local",
    });

    upsertRunStart({
      id,
      projectPath: uiWorkspace.dir,
      projectName: basename(uiWorkspace.dir),
      source: "cursor-agent",
      modelPref: modelPreference,
      startedAt,
      status: "running",
      promptPreview: prompt,
    });

    abortOrThrow();

    const child = spawn(cursorExe, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: uiWorkspace.dir,
      env: process.env,
    });
    agentRunChildProcesses.set(id, child);

    child.on("error", (error) => {
      agentRunChildProcesses.delete(id);
      session.status = "error";
      session.error = error.message;
      session.endedAt = new Date().toISOString();
      pushEvent("status", `spawn error: ${error.message}`);
      void persistRecord();
      finalizeRun(id, "error", 1, session.endedAt);
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
              session.output += "\n";
            }
          } else if (data.type === "result") {
            if (data.subtype === "success") {
              if (data.usage) {
                recordRunUsage(id, {
                  inputTokens: Number(data.usage.inputTokens) || 0,
                  outputTokens: Number(data.usage.outputTokens) || 0,
                  model: typeof data.model === "string" ? data.model : undefined,
                });
              }
              const usage = data.usage ? ` (Tokens: ${data.usage.inputTokens} IN / ${data.usage.outputTokens} OUT)` : "";
              pushEvent("status", `✓ Run completed${usage}`);
            } else {
              pushEvent("status", `Result: ${data.subtype}`);
            }
          }
        } catch {
          session.output += `${line}\n`;
          pushEvent("assistant", `${line}\n`);
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
      agentRunChildProcesses.delete(id);
      void (async () => {
        session.exitCode = code ?? 1;
        session.status = session.exitCode === 0 ? "done" : "error";
        session.endedAt = new Date().toISOString();
        const msg =
          session.exitCode === 0
            ? "✨ Session closed successfully."
            : `❌ Session ended with error (exit code: ${session.exitCode})`;
        pushEvent("status", msg);
        void persistRecord();
        finalizeRun(id, session.status, session.exitCode ?? null, session.endedAt);
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
      })();
    });

    return session;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`);
    if (!isAuthorized(url)) {
      sendJson(res, 401, { ok: false, error: "unauthorized: invalid or missing token" });
      return;
    }

    if (url.pathname === "/api/workspace/cwd" && req.method === "GET") {
      sendJson(res, 200, {
        cwd: uiWorkspace.dir,
        launchRoot: winnowLaunchRoot,
        transcriptDir: cursorTranscriptDirForUi(),
      });
      return;
    }

    if (url.pathname === "/api/system" && req.method === "GET") {
      sendJson(res, 200, {
        platform: platform(),
        arch: arch(),
        cpus: cpus().length,
        cpuModel: cpus()[0]?.model,
        totalMem: totalmem(),
        freeMem: freemem(),
        uptime: uptime(),
        loadAvg: loadavg(),
        nodeVersion: process.version,
      });
      return;
    }

    if (url.pathname === "/api/dashboard/last-agent-run" && req.method === "GET") {
      const r = queryLastAgentRun();
      if (!r.ok) {
        sendJson(res, 200, {
          ok: false,
          reason: r.reason,
          run: null,
          transcriptBase: cursorTranscriptDirForUi(),
        });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        run: r.run,
        transcriptBase: cursorTranscriptDirForUi(),
      });
      return;
    }

    if (url.pathname === "/api/dashboard/disk" && req.method === "GET") {
      try {
        const body = await buildDiskDashboard({
          volumePath: uiWorkspace.dir,
        });
        sendJson(res, 200, { ...body, workspaceRoot: uiWorkspace.dir });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/projects" && req.method === "GET") {
      const projects = await listProjects();
      sendJson(res, 200, { projects });
      return;
    }

    if (url.pathname === "/api/usage/status" && req.method === "GET") {
      sendJson(res, 200, usageDbStatus());
      return;
    }

    if (url.pathname === "/api/usage/summary" && req.method === "GET") {
      const rawRange = url.searchParams.get("range") ?? "all";
      const range = (["today", "7d", "30d", "all"].includes(rawRange) ? rawRange : "all") as "today" | "7d" | "30d" | "all";
      sendJson(res, 200, querySummary(range));
      return;
    }

    if (url.pathname === "/api/usage/timeseries" && req.method === "GET") {
      const rawRange = url.searchParams.get("range") ?? "7d";
      const allowedRanges = ["24h", "7d", "30d", "90d", "all"] as const;
      const range = allowedRanges.includes(rawRange as (typeof allowedRanges)[number])
        ? (rawRange as (typeof allowedRanges)[number])
        : "7d";
      const rawBucket = url.searchParams.get("bucket") ?? "day";
      const allowedBuckets = ["hour", "day", "week"] as const;
      const bucket = allowedBuckets.includes(rawBucket as (typeof allowedBuckets)[number])
        ? (rawBucket as (typeof allowedBuckets)[number])
        : "day";
      const body = queryTimeseries({
        range,
        bucket,
        projectPath: url.searchParams.get("projectPath") ?? undefined,
        model: url.searchParams.get("model") ?? undefined,
        source: url.searchParams.get("source") ?? undefined,
      });
      sendJson(res, 200, body);
      return;
    }

    if (url.pathname === "/api/usage/runs" && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const body = queryRuns({
        limit: Number.isFinite(limit) ? limit : 50,
        projectPath: url.searchParams.get("projectPath") ?? undefined,
        model: url.searchParams.get("model") ?? undefined,
        source: url.searchParams.get("source") ?? undefined,
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
      });
      sendJson(res, 200, body);
      return;
    }

    if (url.pathname === "/api/usage/filters" && req.method === "GET") {
      sendJson(res, 200, queryFilters());
      return;
    }

    if (url.pathname === "/api/workspace/cwd" && req.method === "POST") {
      try {
        const payload = (await readJsonBody(req)) as { path?: string; reset?: boolean };
        if (payload.reset) {
          const next = await applyWorkspaceDir(winnowLaunchRoot, true);
          await registerProject(next);
          void rebuildAndWriteProjectDocsIndex(next).catch(() => {});
          sendJson(res, 200, {
            ok: true,
            cwd: next,
            transcriptDir: cursorTranscriptDirForUi(),
            launchRoot: winnowLaunchRoot,
          });
          return;
        }
        const raw = payload.path?.trim();
        if (!raw) {
          sendJson(res, 400, { ok: false, error: "path is required unless reset is true" });
          return;
        }
        const candidate = resolveUiPath(raw);
        const next = await applyWorkspaceDir(candidate, true);
        await registerProject(next);
        void rebuildAndWriteProjectDocsIndex(next).catch(() => {});
        sendJson(res, 200, {
          ok: true,
          cwd: next,
          transcriptDir: cursorTranscriptDirForUi(),
          launchRoot: winnowLaunchRoot,
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
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

    if (url.pathname === "/api/workspace/docs-index" && req.method === "GET") {
      try {
        const refresh = url.searchParams.get("refresh") === "1";
        let index = await readProjectDocsIndex(uiWorkspace.dir);
        if (refresh || !index) {
          index = await rebuildAndWriteProjectDocsIndex(uiWorkspace.dir);
        }
        sendJson(res, 200, { ok: true, index });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/workspace/doc" && req.method === "GET") {
      try {
        const rel = url.searchParams.get("path") ?? "";
        const abs = resolveDocFilePath(uiWorkspace.dir, rel);
        const info = await stat(abs);
        if (!info.isFile()) {
          sendJson(res, 400, { ok: false, error: "not a file" });
          return;
        }
        const lower = abs.toLowerCase();
        if (lower.endsWith(".md")) {
          const markdown = await readFile(abs, "utf8");
          sendJson(res, 200, { ok: true, kind: "md" as const, relPath: rel, markdown });
          return;
        }
        if (lower.endsWith(".pdf")) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Length", String(info.size));
          createReadStream(abs).pipe(res);
          return;
        }
        sendJson(res, 400, { ok: false, error: "unsupported file type" });
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

    if (url.pathname === "/api/env" && req.method === "GET") {
      try {
        const fileRecord = readDotenvFile(winnowLaunchRoot);
        const entries = WINNOW_DOTENV_SPECS.map((spec) => {
          const fromProc = process.env[spec.key];
          const fromFile = fileRecord[spec.key];
          const effective = String(fromProc ?? fromFile ?? "");
          const hasValue = effective.trim().length > 0;
          return {
            key: spec.key,
            description: spec.description,
            sensitive: Boolean(spec.sensitive),
            value: spec.sensitive ? "" : effective,
            hasValue,
          };
        });
        sendJson(res, 200, { ok: true, entries });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/env" && req.method === "POST") {
      try {
        const body = (await readJsonBody(req)) as { values?: Record<string, string> };
        const incoming = body.values ?? {};
        const prev = readDotenvFile(winnowLaunchRoot);
        const merged: Record<string, string> = { ...prev };
        for (const spec of WINNOW_DOTENV_SPECS) {
          if (!(spec.key in incoming)) {
            continue;
          }
          const v = incoming[spec.key];
          if (v === undefined) {
            continue;
          }
          if (spec.sensitive && String(v).trim() === "") {
            continue;
          }
          merged[spec.key] = String(v);
        }
        writeDotenvFileFull(winnowLaunchRoot, merged);
        loadDotenvFromDisk(winnowLaunchRoot, { override: true });
        const fromEnv = loadConfigFromEnv();
        const profile = await loadProjectProfile();
        config = applyProjectProfile(fromEnv, profile);
        sendJson(res, 200, { ok: true, message: "Saved .env and reloaded configuration in this process." });
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
        const explicitDir = url.searchParams.get("dir") ?? undefined;
        const max = Number.isFinite(limit) ? limit : 20;
        const local = await listLocalSessions(max);
        const envTranscripts = Boolean(process.env.WINNOW_AGENT_TRANSCRIPTS_DIR?.trim());
        let cursor: SessionSummary[];
        let transcriptDirLabel: string;
        if (explicitDir) {
          transcriptDirLabel = getTranscriptDir(explicitDir);
          cursor = await listCursorSessions(max, transcriptDirLabel).catch(() => []);
        } else if (envTranscripts) {
          transcriptDirLabel = getTranscriptDir();
          cursor = await listCursorSessions(max, transcriptDirLabel).catch(() => []);
        } else {
          transcriptDirLabel = agentTranscriptDirForWorkspaceRoot(uiWorkspace.dir);
          cursor = await listCursorSessionsForWorkspaceRoot(uiWorkspace.dir, max).catch(() => []);
        }
        const mergedRaw = [...local, ...cursor].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        const byId = new Map<string, SessionSummary>();
        for (const s of mergedRaw) {
          const prev = byId.get(s.id);
          if (!prev || prev.updatedAt < s.updatedAt) {
            byId.set(s.id, s);
          }
        }
        const merged = [...byId.values()]
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
          .slice(0, max);
        sendJson(res, 200, {
          sessions: merged,
          dir: transcriptDirLabel,
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
        const explicitDir = url.searchParams.get("dir") ?? undefined;
        const envTranscripts = Boolean(process.env.WINNOW_AGENT_TRANSCRIPTS_DIR?.trim());
        let session: { id: string; messages: SessionMessage[] };
        try {
          session = await readLocalSession(id);
        } catch {
          if (explicitDir) {
            session = await readCursorSession(id, explicitDir);
          } else if (envTranscripts) {
            session = await readCursorSession(id);
          } else {
            session = await readCursorSession(id, undefined, uiWorkspace.dir);
          }
        }
        sendJson(res, 200, session);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/translate/deepseek-smoke" && req.method === "GET") {
      try {
        const { smokeTestDeepseekChat } = await import("../translator/deepseekChat.js");
        const r = await smokeTestDeepseekChat(config);
        sendJson(res, 200, {
          ok: r.ok,
          attemptedUrls: r.attemptedUrls,
          lastUrl: r.lastUrl,
          lastStatus: r.lastStatus,
          lastBodySnippet: r.lastBodySnippet,
          error: r.error,
        });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/agent/start" && req.method === "POST") {
      const abortFromDisconnect = new AbortController();
      // Do not use req "close" — it fires when the *incoming* request stream ends (e.g. after the
      // POST body is read), which aborts immediately. Use response "close" only before any reply
      // is sent, i.e. the client actually disconnected while waiting.
      const onClientGone = (): void => {
        if (!res.headersSent) {
          abortFromDisconnect.abort();
        }
      };
      res.on("close", onClientGone);
      try {
        const payload = (await readJsonBody(req)) as AgentStartRequest;
        if (!payload.prompt?.trim()) {
          sendJson(res, 400, { ok: false, error: "prompt is required" });
          return;
        }
        const session = await startAgentSession(payload, { signal: abortFromDisconnect.signal });
        sendJson(res, 200, { ok: true, sessionId: session.id });
      } catch (error) {
        const aborted =
          error instanceof DOMException && error.name === "AbortError"
            ? true
            : (error as Error)?.name === "AbortError";
        if (aborted) {
          if (!res.headersSent) {
            sendJson(res, 499, { ok: false, error: "cancelled" });
          }
          return;
        }
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      } finally {
        res.removeListener("close", onClientGone);
      }
      return;
    }

    if (url.pathname.startsWith("/api/agent/") && url.pathname.endsWith("/stop") && req.method === "POST") {
      const id = url.pathname.slice("/api/agent/".length, -"/stop".length);
      const session = sessions.get(id);
      if (!session) {
        sendJson(res, 404, { ok: false, error: "session not found" });
        return;
      }
      if (session.status !== "running") {
        sendJson(res, 200, { ok: true, stopped: false, message: "session not running" });
        return;
      }
      const child = agentRunChildProcesses.get(id);
      if (!child || child.killed) {
        sendJson(res, 200, { ok: true, stopped: false, message: "no active process handle" });
        return;
      }
      try {
        child.kill("SIGTERM");
        sendJson(res, 200, { ok: true, stopped: true });
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
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
      :root {
        /* True black (OLED: pixels off). Primary = pastel + neon cyan; accents = red family. */
        --bg: #000000;
        --panel: #000000;
        --panel2: #0a0a0a;
        --line: rgba(34, 211, 238, 0.32);
        --line-faint: rgba(34, 211, 238, 0.12);
        --text: #7dd3fc;
        --text-strong: #22d3ee;
        --text-neon: #5eead4;
        --muted: rgba(125, 211, 252, 0.58);
        --accent: #22d3ee;
        --accent-hover: #67e8f9;
        --red-pastel: #fecaca;
        --red-neon: #f87171;
        --danger: #f87171;
        --success: #2dd4bf;
        --radius: 8px;
        --radius-sm: 6px;
        --shadow: none;
        --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      * { box-sizing: border-box; }
      html { height: 100%; }
      body {
        margin: 0;
        padding: 0;
        min-height: 100%;
        background: var(--bg);
        color: var(--text);
        font-family: var(--font-sans);
        font-size: 13px;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
        overflow-x: hidden;
        overflow-y: auto;
      }
      /* Main shell: at least one viewport tall; content grows and window scrolls (no column trap). */
      .app { display: flex; flex-direction: column; min-height: 100vh; min-height: 100dvh; }
      .main-grid-dock {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 10000;
        margin: 0;
        padding: 0;
        background: var(--bg);
      }
      .main-grid-frame {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: var(--bg);
      }
      .topbar {
        height: 48px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 16px;
        border-bottom: 1px solid var(--line);
        background: var(--panel);
        box-shadow: none;
        z-index: 10;
      }
      .tab {
        padding: 6px 12px;
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        background: transparent;
        font-size: 13px;
        font-weight: 500;
        color: var(--muted);
        cursor: pointer;
        transition: all 0.2s;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
      }
      .tab:hover { color: var(--text-strong); background: rgba(34, 211, 238, 0.08); }
      .tab.active { color: var(--text-neon); background: var(--panel2); border-color: var(--line); font-weight: 600; }
      .body {
        flex: 0 0 auto;
        display: grid;
        grid-template-columns: minmax(360px, 40%) minmax(520px, 1fr);
        gap: 16px;
        padding: 16px;
        align-content: start;
        min-height: calc(100vh - 48px);
        min-height: calc(100dvh - 48px);
      }
      .body.single { grid-template-columns: 100%; }
      .leftCol, .rightCol {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-height: 0;
        overflow: visible;
        padding-right: 0;
        align-items: stretch;
      }
      .leftCol > .panel { flex-shrink: 0; }
      .leftCol > .panel.flex-panel { flex: 0 0 auto; min-height: 0; }
      .rightCol > .panel { flex: 0 0 auto; display: flex; flex-direction: column; min-height: 0; }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        padding: 16px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
        box-shadow: var(--shadow);
      }
      .title { font-size: 14px; font-weight: 700; color: var(--text-neon); letter-spacing: 0.02em; margin: 0; }
      strong, b { color: var(--text-strong); font-weight: 700; }
      code { font-family: var(--font-mono); color: var(--text-strong); font-weight: 600; font-size: 0.95em; }
      .hint { font-size: 12px; color: var(--muted); margin: 0; font-style: italic; }
      .metricLabel { font-style: italic; }
      .dashboardSubline, #sysRefreshedAt, #diskMeasuredAt { font-style: italic; }
      .projectTime { font-style: italic; }
      .muted { color: var(--muted); }
      .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      input, select, button, textarea {
        background: var(--bg);
        border: 1px solid var(--line);
        color: var(--text-strong);
        border-radius: var(--radius-sm);
        padding: 6px 10px;
        font-family: inherit;
        font-size: 13px;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.22); }
      button { cursor: pointer; font-weight: 500; background: var(--panel2); }
      button:hover { background: var(--line-faint); border-color: var(--accent); color: var(--text-neon); }
      pre {
        margin: 0;
        background: var(--bg);
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        padding: 10px;
        white-space: pre-wrap;
        overflow: auto;
        flex: 0 0 auto;
        min-height: 0;
        font-size: 12px;
        font-family: var(--font-mono);
        color: var(--text);
      }
      #agentThinking {
        flex-shrink: 0;
        max-height: 160px;
        min-height: 40px;
        overflow-y: auto;
        font-size: 12px;
        padding: 10px;
        background: var(--panel2);
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        font-family: var(--font-mono);
        white-space: pre-wrap;
        color: var(--muted);
        margin: 0;
      }
      textarea { width: 100%; min-height: 100px; resize: vertical; font-family: var(--font-mono); margin: 0; }
      #workspaceFiles, #dirEntries {
        overflow: auto;
        max-height: 140px;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        padding: 4px;
        background: var(--bg);
        margin: 0;
      }
      .entry { display: block; border: 0; background: transparent; color: var(--text); text-align: left; padding: 4px 8px; width: 100%; border-radius: 4px; margin: 0; }
      .entry:hover { background: var(--panel2); color: var(--text-strong); }
      .small { font-size: 12px; }
      .quickbar { display: flex; gap: 8px; flex-wrap: wrap; margin: 0; }
      .quickbar button { padding: 4px 10px; font-size: 12px; border-radius: 99px; }
      .runRow { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 0; }
      .kbd {
        border: 1px solid var(--line);
        border-bottom-width: 2px;
        padding: 2px 6px;
        border-radius: 4px;
        background: var(--panel2);
        color: var(--muted);
        font-size: 11px;
        font-family: var(--font-mono);
      }
      button.secondary {
        background: var(--panel2);
        border-color: var(--line);
        color: var(--text-neon);
        font-weight: 600;
      }
      button.secondary:hover {
        border-color: var(--accent);
        color: var(--text-strong);
      }
      .env-fields .env-row {
        margin-bottom: 12px;
      }
      .env-fields label {
        display: block;
        font-size: 12px;
        color: var(--muted);
        margin-bottom: 4px;
      }
      .env-fields input {
        width: 100%;
        box-sizing: border-box;
      }
      .statusBadge {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border: 1px solid var(--line);
        border-radius: 99px;
        font-size: 11px;
        font-weight: 600;
        color: var(--text);
        background: var(--panel2);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0; }
      .metric { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 8px 10px; background: var(--bg); }
      .metricLabel { font-size: 11px; color: var(--muted); font-weight: 500; text-transform: uppercase; margin-bottom: 4px; }
      .metricValue { font-size: 14px; color: var(--text-strong); font-weight: 600; font-family: var(--font-mono); }
      .metrics.dashboardMetrics {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .body.dashboard-mode {
        gap: 18px;
        padding: 18px;
      }
      .body.dashboard-mode .leftCol {
        max-width: 1200px;
        margin: 0 auto;
        width: 100%;
        overflow: visible;
      }
      .body.dashboard-mode .panel {
        padding: 18px;
        gap: 14px;
      }
      .body.dashboard-mode .title {
        font-size: 15px;
        letter-spacing: 0.015em;
      }
      .body.dashboard-mode .dashboard-panel {
        min-height: 0;
      }
      .body.dashboard-mode .dashboard-system {
        flex-shrink: 0;
      }
      .body.dashboard-mode .dashboard-lastrun,
      .body.dashboard-mode .dashboard-disk {
        flex-shrink: 0;
      }
      /* Token usage card: do not flex-shrink (was clipping chart at 100% zoom). */
      .body.dashboard-mode .leftCol > .panel.dashboard-usage.flex-panel {
        flex: 0 0 auto;
        align-self: stretch;
        min-height: 0;
      }
      .body.dashboard-mode .leftCol > .panel.dashboard-projects.flex-panel {
        flex: 0 0 auto;
        min-height: 0;
      }
      .body.dashboard-mode .panel.dashboard-usage {
        overflow-x: hidden;
        overflow-y: visible;
      }
      #usageMainWrap {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-height: 0;
        flex: 0 0 auto;
        overflow-x: hidden;
        overflow-y: visible;
      }
      .body.dashboard-mode .dashboard-projects {
        min-height: 0;
      }
      .body.dashboard-mode .dashboard-usage .hint {
        color: var(--muted);
      }
      .body.dashboard-mode .dashboard-usage .metrics.dashboardMetrics,
      .body.dashboard-mode .dashboard-system .metrics.dashboardMetrics {
        gap: 10px;
      }
      .body.dashboard-mode .metric {
        background: linear-gradient(180deg, rgba(5, 25, 30, 0.55), rgba(0, 0, 0, 0.98));
        border-color: var(--line);
      }
      #usageKpiTodayIn, #usageKpiLifeIn { color: var(--text-strong); font-weight: 700; }
      #usageKpiTodayOut, #usageKpiLifeOut { color: var(--red-pastel); font-weight: 700; }
      #usageKpiCostLife { color: var(--red-neon); font-weight: 700; }
      .body.dashboard-mode .metricLabel {
        font-size: 10px;
        letter-spacing: 0.06em;
      }
      .body.dashboard-mode .metricValue {
        font-size: 15px;
      }
      .dashboardSubline {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
        color: var(--muted);
        font-size: 12px;
      }
      .body.dashboard-mode .dashboardSubline {
        padding-top: 4px;
        border-top: 1px solid var(--line-faint);
      }
      .projectToolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .projectToolbar input {
        flex: 1;
        min-width: 220px;
      }
      .projectToolbar button {
        flex-shrink: 0;
      }
      .projectMetaBadge {
        border: 1px solid var(--line);
        background: var(--panel2);
        border-radius: 99px;
        padding: 3px 9px;
        font-size: 11px;
        color: var(--muted);
      }
      .body.dashboard-mode .projectMetaBadge {
        color: var(--text);
        border-color: var(--line);
      }
      .projectCard {
        width: 100%;
        border: 1px solid transparent;
        border-bottom-color: var(--line);
        background: transparent;
        color: var(--text);
        text-align: left;
        padding: 12px;
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
        overflow: hidden;
        transition: background 0.15s, border-color 0.15s;
      }
      .projectMain {
        flex: 1;
        min-width: 0;
      }
      .projectCard:hover {
        background: var(--panel2);
        border-color: var(--line);
      }
      .projectCard:last-child {
        border-bottom: 0;
      }
      .projectName {
        font-weight: 700;
        color: var(--text-neon);
      }
      .projectPath {
        margin-top: 4px;
        color: var(--muted);
        font-size: 12px;
        word-break: break-all;
        font-family: var(--font-mono);
      }
      .projectTime {
        color: var(--muted);
        font-size: 12px;
        white-space: nowrap;
        flex-shrink: 0;
        text-align: right;
      }
      #chatHistory {
        overflow: visible;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        background: var(--bg);
        padding: 12px;
        flex: 0 0 auto;
        min-height: 160px;
        margin: 0;
      }
      .chatMsg {
        margin-bottom: 12px;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        padding: 12px;
        background: var(--panel);
        box-shadow: none;
      }
      .chatMsg:last-child { margin-bottom: 0; }
      .chatRole { font-size: 11px; color: var(--muted); margin-bottom: 6px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; font-style: italic; }
      .chatText { white-space: pre-wrap; font-size: 13px; font-family: var(--font-mono); line-height: 1.5; color: var(--text); }
      @keyframes winnow-spin {
        to { transform: rotate(360deg); }
      }
      .agent-run-wrap {
        position: relative;
        display: inline-flex;
        vertical-align: middle;
      }
      .agent-run-overlay-spinner {
        display: none;
        position: absolute;
        left: 50%;
        top: 50%;
        width: 18px;
        height: 18px;
        margin: -9px 0 0 -9px;
        border: 2px solid var(--line);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: winnow-spin 0.7s linear infinite;
        pointer-events: none;
      }
      .agent-run-wrap.is-busy .agent-run-overlay-spinner {
        display: block;
      }
      .agent-run-wrap.is-busy > button[data-agent-run] {
        opacity: 0.45;
      }
      .agent-run-cancel-btn {
        margin-left: 6px;
      }
      .agent-run-loading {
        display: none;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        margin-top: 10px;
        padding: 14px 16px;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        background: var(--panel2);
      }
      .agent-run-loading.is-visible {
        display: flex;
      }
      .agent-run-loading-top {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        justify-content: center;
        text-align: center;
      }
      .agent-run-spinner-lg {
        width: 22px;
        height: 22px;
        flex-shrink: 0;
        border: 2px solid var(--line);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: winnow-spin 0.75s linear infinite;
      }
      .agent-run-flavor {
        font-size: 12px;
        font-style: italic;
        line-height: 1.45;
        max-width: 520px;
        margin: 0;
        color: var(--muted);
      }
      #agentPrompt:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      #btnAgentRunCancel {
        min-width: 120px;
      }
      .usageToolbar { margin-top: 4px; }
      .usageToolbar select { max-width: 100%; width: 100%; min-width: 0; }
      .body.dashboard-mode .usageToolbar {
        display: grid;
        grid-template-columns: repeat(3, minmax(180px, 1fr));
        padding: 8px 10px;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        background: var(--line-faint);
        gap: 8px;
      }
      .body.dashboard-mode .usageToolbar label {
        font-size: 11px;
        color: var(--muted);
        font-style: italic;
        font-weight: 600;
      }
      .usageControl {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .usageActions {
        display: flex;
        gap: 8px;
        align-items: center;
        justify-content: flex-end;
        grid-column: 1 / -1;
      }
      .usageActions .stackedToggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .usageChartWrap {
        position: relative;
        width: 100%;
        height: 220px;
        min-height: 200px;
        max-height: 260px;
        flex: 0 0 auto;
        align-self: stretch;
        margin-top: 2px;
      }
      .usageChartWrap canvas {
        width: 100% !important;
        height: 100% !important;
        display: block;
      }
      .usageChartEmpty {
        position: absolute;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        color: var(--muted);
        font-size: 12px;
        font-style: italic;
        border: 1px dashed var(--line);
        border-radius: var(--radius-sm);
        background: var(--line-faint);
        pointer-events: none;
      }
      .usageRecentRunsLabel { margin-top: 10px; }
      .usageRunsWrap {
        overflow: auto;
        flex: 0 0 auto;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        background: var(--bg);
        max-height: 220px;
        margin-top: 4px;
      }
      .body.dashboard-mode .usageRunsWrap {
        border-color: var(--line);
      }
      #projectList.projectList {
        overflow: auto;
        flex: 1;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        padding: 6px;
        background: var(--bg);
        min-height: 160px;
      }
      .body.dashboard-mode #projectList.projectList {
        border-color: var(--line);
      }
      .usageTable { width: 100%; border-collapse: collapse; font-size: 12px; }
      .usageTable th, .usageTable td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
      .usageTable th { color: var(--muted); font-weight: 600; position: sticky; top: 0; background: var(--bg); z-index: 1; }
      .body.dashboard-mode .usageTable th {
        background: #000000;
        color: var(--text-neon);
        font-style: italic;
        border-bottom-color: var(--line);
      }
      .body.dashboard-mode .usageTable td {
        border-bottom-color: var(--line-faint);
      }
      .usageTokIn { color: var(--text-strong); font-weight: 600; }
      .usageTokOut { color: var(--red-pastel); font-weight: 600; }
      .usageCost { color: var(--red-neon); font-weight: 700; }
      .body.dashboard-mode .usageTable tbody tr:hover td {
        background: var(--line-faint);
      }
      @media (max-width: 1280px) {
        .body {
          grid-template-columns: minmax(320px, 42%) minmax(0, 1fr);
          gap: 14px;
          padding: 14px;
        }
        .body.dashboard-mode {
          gap: 14px;
          padding: 14px;
        }
      }
      @media (max-width: 960px) {
        .body {
          grid-template-columns: 1fr;
        }
        .body.dashboard-mode .panel {
          padding: 14px;
        }
        .body.dashboard-mode .dashboardSubline {
          flex-direction: column;
          align-items: flex-start;
        }
        .body.dashboard-mode .metrics.dashboardMetrics {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .body.dashboard-mode .usageToolbar select {
          max-width: none;
          min-width: 140px;
        }
        .body.dashboard-mode .usageToolbar {
          grid-template-columns: repeat(2, minmax(140px, 1fr));
        }
      }
      @media (max-width: 780px) {
        .body.dashboard-mode .usageToolbar {
          grid-template-columns: 1fr;
        }
        .usageActions {
          justify-content: flex-start;
        }
        .usageChartWrap {
          height: 200px;
          min-height: 180px;
          max-height: 220px;
        }
      }
      @media (max-width: 640px) {
        .body.dashboard-mode .metrics.dashboardMetrics {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <div class="topbar">
        <button class="tab active" data-view="os">Dashboard</button>
        <button class="tab" data-view="agent">Cursor Agent</button>
        <button class="tab" data-view="settings">Settings</button>
        <button id="mainGridBtn" class="tab">Main Grid</button>
      </div>
      <div class="body">
        <div class="leftCol">
          <!-- Dashboard specific panels -->
          <div class="panel dashboard-only dashboard-panel dashboard-system">
            <div class="title">System Status</div>
            <div class="metrics dashboardMetrics">
              <div class="metric"><div class="metricLabel">Platform</div><div class="metricValue" id="sysPlatform">...</div></div>
              <div class="metric"><div class="metricLabel">CPU</div><div class="metricValue" id="sysCpus">...</div></div>
              <div class="metric"><div class="metricLabel">Mem Free</div><div class="metricValue" id="sysMemFree">...</div></div>
              <div class="metric"><div class="metricLabel">Uptime</div><div class="metricValue" id="sysUptime">...</div></div>
              <div class="metric"><div class="metricLabel">Node</div><div class="metricValue" id="sysNode">...</div></div>
              <div class="metric"><div class="metricLabel">Load Avg</div><div class="metricValue" id="sysLoadAvg">...</div></div>
            </div>
            <div class="dashboardSubline">
              <span id="sysCpuModel"></span>
              <span id="sysRefreshedAt">Updated just now</span>
            </div>
          </div>

          <div class="panel dashboard-only dashboard-panel dashboard-lastrun">
            <div class="title">Last agent run</div>
            <div id="lastRunContent" class="muted small">Loading…</div>
          </div>

          <div class="panel dashboard-only dashboard-panel dashboard-disk">
            <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <div class="title" style="margin:0">Disk &amp; project sizes</div>
              <div class="row small">
                <button type="button" id="diskRefreshBtn" onclick="refreshDiskDashboard()">Refresh</button>
                <span class="muted" id="diskMeasuredAt"></span>
              </div>
            </div>
            <div id="diskContent" class="small muted">Loading…</div>
            <p class="hint" id="diskNote" style="display:none"></p>
          </div>

          <div id="usageTokenSection" class="panel dashboard-only flex-panel dashboard-panel dashboard-usage">
            <div class="title">Token usage (global)</div>
            <p class="hint" id="usageDbHint">Costs are <strong>estimates</strong> from token counts. Set per-model USD per 1k tokens in <code>~/.winnow/pricing.json</code>.</p>
            <div id="usageUnavailable" class="muted small" style="display:none;padding:8px 0"></div>
            <div id="usageMainWrap">
              <div class="metrics dashboardMetrics" id="usageKpis">
                <div class="metric"><div class="metricLabel">In (today)</div><div class="metricValue" id="usageKpiTodayIn">0</div></div>
                <div class="metric"><div class="metricLabel">Out (today)</div><div class="metricValue" id="usageKpiTodayOut">0</div></div>
                <div class="metric"><div class="metricLabel">In (lifetime)</div><div class="metricValue" id="usageKpiLifeIn">0</div></div>
                <div class="metric"><div class="metricLabel">Out (lifetime)</div><div class="metricValue" id="usageKpiLifeOut">0</div></div>
                <div class="metric"><div class="metricLabel">Runs today</div><div class="metricValue" id="usageKpiRunsToday">0</div></div>
                <div class="metric"><div class="metricLabel">Est. cost (life)</div><div class="metricValue" id="usageKpiCostLife">$0</div></div>
              </div>
              <div class="projectToolbar usageToolbar">
                <div class="usageControl">
                  <label class="small muted" for="usageChartRange">Chart range</label>
                  <select id="usageChartRange">
                    <option value="24h">24h</option>
                    <option value="7d" selected>7d</option>
                    <option value="30d">30d</option>
                    <option value="90d">90d</option>
                    <option value="all">All</option>
                  </select>
                </div>
                <div class="usageControl">
                  <label class="small muted" for="usageChartBucket">Bucket</label>
                  <select id="usageChartBucket">
                    <option value="hour">Hour</option>
                    <option value="day" selected>Day</option>
                    <option value="week">Week</option>
                  </select>
                </div>
                <div class="usageControl">
                  <label class="small muted" for="usageFilterProject">Project</label>
                  <select id="usageFilterProject"><option value="">(all)</option></select>
                </div>
                <div class="usageControl">
                  <label class="small muted" for="usageFilterModel">Model</label>
                  <select id="usageFilterModel"><option value="">(all)</option></select>
                </div>
                <div class="usageControl">
                  <label class="small muted" for="usageFilterSource">Source</label>
                  <select id="usageFilterSource"><option value="">(all)</option></select>
                </div>
                <div class="usageActions">
                  <label class="small muted stackedToggle"><input type="checkbox" id="usageStacked" /> Stacked</label>
                  <button type="button" onclick="refreshUsageDashboard()">Refresh</button>
                </div>
              </div>
              <div class="usageChartWrap">
                <canvas id="usageChartCanvas"></canvas>
                <div id="usageChartEmpty" class="usageChartEmpty">No chartable usage data for this filter/range.</div>
              </div>
              <div class="small muted usageRecentRunsLabel">Recent runs</div>
              <div class="usageRunsWrap">
                <table class="usageTable" id="usageRunsTable">
                  <thead><tr><th>Started</th><th>Project</th><th>Model</th><th>In</th><th>Out</th><th>Cost</th><th>Status</th></tr></thead>
                  <tbody id="usageRunsBody"><tr><td colspan="7" class="muted small">Loading…</td></tr></tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="panel flex-panel dashboard-only dashboard-panel dashboard-projects">
            <div class="title">Recent Projects</div>
            <div class="projectToolbar">
              <input id="projectFilter" placeholder="Filter by name or path..." />
              <button onclick="refreshProjects()">Refresh</button>
              <span class="projectMetaBadge" id="projectCountBadge">0 projects</span>
            </div>
            <div id="projectList" class="projectList">
              <div class="muted small" style="padding:8px">Loading projects...</div>
            </div>
            <div class="hint">Directories containing a <code>.winnow</code> folder are registered as projects.</div>
          </div>

          <!-- Agent specific panels -->
          <div class="panel agent-only" style="display:none">
            <div class="title">Working directory (agent, PTYs, git, files)</div>
            <div class="row small">
              <input id="workspacePathInput" style="flex:1;min-width:140px" placeholder="Absolute path, ~/…, or relative to cwd" />
              <button onclick="setWorkspaceCwd()">Switch Workspace</button>
              <button onclick="resetWorkspaceCwd()">Reset to launch</button>
            </div>
            <div class="small muted" id="workspaceCwdHint"></div>
          </div>
          <div class="panel flex-panel agent-only" style="display:none">
            <div class="title">Directory Navigator (ranger-like)</div>
            <div class="row small">
              <button onclick="goParent()">Up</button>
              <button onclick="refreshDir()">Refresh</button>
              <span class="muted small" id="dirCwd"></span>
            </div>
            <div id="dirEntries"></div>
            <div class="small muted">Preview: <span id="dirPreviewPath"></span></div>
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
          <div class="panel flex-panel" style="min-height: 200px;">
            <div class="title">Recent Logs</div>
            <pre id="logs">Loading...</pre>
          </div>
          <div class="panel">
            <div class="title">Cursor Sessions Sync</div>
            <div class="row small">
              <button onclick="refreshSessions()">Refresh</button>
            </div>
            <div class="small muted" id="sessionDirInfo"></div>
            <div id="sessionList" style="overflow:auto;max-height:120px;border:1px solid var(--line);border-radius:var(--radius-sm);padding:4px;background:var(--bg)"></div>
            <div class="row small">
              <button onclick="continueSelectedSession()">Continue Selected</button>
              <button onclick="useSelectedPrompt()">Use Last Prompt</button>
            </div>
            <pre id="sessionPreview">No session selected.</pre>
          </div>
          <div class="panel settings-only flex-panel" style="display:none">
            <div class="title">Environment (.env)</div>
            <p class="hint">
              Loads <code>.env</code> from the project directory when Winnow starts (shell variables still win if both are set).
              Saving rewrites <code>.env</code> and reloads config in this server process. Use
              <code>DEEPSEEK_API_KEY</code> — the typo <code>DEEP_SEEK_API_KEY</code> is read as a fallback only.
            </p>
            <div id="envFields" class="env-fields"></div>
            <div class="row small" style="margin-top:12px">
              <button type="button" id="btnSaveEnv">Save .env</button>
              <button type="button" class="secondary" id="btnReloadEnv">Reload form</button>
            </div>
            <pre id="envSaveHint" class="small muted" style="margin:0;min-height:1.2em"></pre>
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
              <span class="agent-run-wrap" id="agentRunWrap">
                <button type="button" id="btnAgentRun" data-agent-run="1" onclick="startAgentRun()">Run</button>
                <span class="agent-run-overlay-spinner" aria-hidden="true"></span>
              </span>
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
            <div class="small muted">Thinking trace</div>
            <pre id="agentThinking">No thinking trace yet.</pre>
            <div class="small muted">Chat history</div>
            <div id="chatHistory"></div>
            <textarea id="agentPrompt" placeholder="Describe the coding task for Cursor agent...\n\nGood prompt pattern:\n- Goal\n- Constraints\n- Files to touch\n- Validation steps"></textarea>
            <div id="agentRunLoadingBanner" class="agent-run-loading" role="status" aria-live="polite" aria-hidden="true">
              <div class="agent-run-loading-top">
                <span class="agent-run-spinner-lg" aria-hidden="true"></span>
                <p id="agentRunFlavorText" class="agent-run-flavor">Working…</p>
              </div>
              <button type="button" id="btnAgentRunCancel" class="secondary" onclick="cancelAgentRun()">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div id="mainGridDock" class="main-grid-dock" aria-hidden="true">
      <iframe id="mainGridFrame" class="main-grid-frame" title="Winnow Main Grid"></iframe>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
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
      function hideMainGridDock(){
        const dock = document.getElementById('mainGridDock');
        if(!dock){ return; }
        dock.style.display = 'none';
        dock.setAttribute('aria-hidden','true');
      }
      function showMainGridDock(){
        const dock = document.getElementById('mainGridDock');
        const frame = document.getElementById('mainGridFrame');
        if(!dock || !frame){
          window.location.assign(withToken('/main'));
          return;
        }
        const targetSrc = withToken('/main?dock=1');
        if(!frame.dataset.winnowMainLoaded){
          frame.src = targetSrc;
          frame.dataset.winnowMainLoaded = '1';
        }
        dock.style.display = 'block';
        dock.setAttribute('aria-hidden','false');
        requestAnimationFrame(function(){
          try {
            frame.contentWindow.dispatchEvent(new Event('resize'));
          } catch (_) {}
        });
      }
      function openMainGrid(){
        const dock = document.getElementById('mainGridDock');
        const frame = document.getElementById('mainGridFrame');
        if(dock && frame){
          showMainGridDock();
          return;
        }
        window.location.assign(withToken('/main'));
      }
      window.addEventListener('message', function(event){
        if(event.origin !== window.location.origin){ return; }
        if(event.data && event.data.type === 'winnow-hide-main-grid'){
          hideMainGridDock();
        }
      });
      document.addEventListener('keydown', function(e){
        if(e.key !== 'Escape'){ return; }
        const dock = document.getElementById('mainGridDock');
        if(dock && dock.style.display === 'block'){
          hideMainGridDock();
        }
      });

      let usageChartInstance = null;
      let usageRefreshTimer = null;

      function destroyUsageChart(){
        if(usageChartInstance){
          usageChartInstance.destroy();
          usageChartInstance = null;
        }
      }

      function fmtTok(n){
        return Number(n || 0).toLocaleString();
      }

      /** Compact token counts for chart axes (keeps plot small, labels readable). */
      function fmtTokAxis(value){
        const n = Number(value);
        if(!Number.isFinite(n) || n === 0){
          return '0';
        }
        const abs = Math.abs(n);
        const fmt = function(x, suffix){
          const s = x >= 100 ? String(Math.round(x)) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
          return s.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1') + suffix;
        };
        if(abs >= 1e9){
          return fmt(n / 1e9, 'B');
        }
        if(abs >= 1e6){
          return fmt(n / 1e6, 'M');
        }
        if(abs >= 1e3){
          return fmt(n / 1e3, 'k');
        }
        return String(Math.round(n));
      }

      function fmtMoney(n){
        return '$' + Number(n || 0).toFixed(4);
      }

      function populateUsageSelect(selectId, items, valueKey, labelFn, withAll){
        const sel = document.getElementById(selectId);
        if(!sel){ return; }
        const prev = sel.value;
        sel.innerHTML = '';
        if(withAll){
          const o = document.createElement('option');
          o.value = '';
          o.textContent = '(all)';
          sel.appendChild(o);
        }
        for(const item of items || []){
          const o = document.createElement('option');
          o.value = String(item[valueKey] ?? '');
          o.textContent = labelFn(item);
          sel.appendChild(o);
        }
        if(prev && Array.from(sel.options).some((x) => x.value === prev)){
          sel.value = prev;
        }
      }

      function renderUsageChart(ts){
        const canvas = document.getElementById('usageChartCanvas');
        const empty = document.getElementById('usageChartEmpty');
        if(!canvas || typeof Chart === 'undefined'){ return; }
        destroyUsageChart();
        const buckets = Array.isArray(ts && ts.buckets) ? ts.buckets : [];
        const points = buckets
          .map((b) => {
            const inVal = Number(b && b.in);
            const outVal = Number(b && b.out);
            return {
              label: String((b && b.ts) || '').replace('T', ' ').slice(0, 16),
              inVal: Number.isFinite(inVal) ? inVal : 0,
              outVal: Number.isFinite(outVal) ? outVal : 0,
            };
          })
          .filter((p) => p.label.length > 0);
        const labels = points.map((p) => p.label);
        const ins = points.map((p) => p.inVal);
        const outs = points.map((p) => p.outVal);
        const hasData = labels.length > 0 && (ins.some((n) => n > 0) || outs.some((n) => n > 0));
        if(empty){
          empty.style.display = hasData ? 'none' : 'flex';
        }
        if(!hasData){
          return;
        }
        const stackedEl = document.getElementById('usageStacked');
        const stacked = stackedEl ? stackedEl.checked : false;
        const ctx = canvas.getContext('2d');
        if(!ctx){ return; }
        usageChartInstance = new Chart(ctx, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [
              {
                label: 'Input tokens',
                data: ins,
                borderColor: '#22d3ee',
                backgroundColor: 'rgba(34,211,238,0.14)',
                fill: stacked,
                pointRadius: 0,
                pointHoverRadius: 3,
                tension: 0.3,
                borderWidth: 2
              },
              {
                label: 'Output tokens',
                data: outs,
                borderColor: '#f87171',
                backgroundColor: 'rgba(248,113,113,0.14)',
                fill: stacked,
                pointRadius: 0,
                pointHoverRadius: 3,
                tension: 0.3,
                borderWidth: 2
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            layout: { padding: { top: 6, right: 10, bottom: 2, left: 4 } },
            scales: {
              y: {
                stacked: Boolean(stacked),
                beginAtZero: true,
                ticks: {
                  color: 'rgba(125, 211, 252, 0.85)',
                  precision: 0,
                  font: { size: 13, weight: '600', family: 'ui-monospace, Menlo, monospace' },
                  callback: function(v){
                    return fmtTokAxis(v);
                  }
                },
                grid: { color: 'rgba(34, 211, 238, 0.12)' },
                title: {
                  display: true,
                  text: 'Tokens',
                  color: 'rgba(94, 234, 212, 0.9)',
                  font: { size: 12, weight: '600' }
                }
              },
              x: {
                ticks: {
                  color: 'rgba(125, 211, 252, 0.75)',
                  autoSkip: true,
                  maxTicksLimit: 10,
                  maxRotation: 0,
                  minRotation: 0,
                  font: { size: 12, weight: '500' }
                },
                grid: { color: 'rgba(34, 211, 238, 0.08)' }
              }
            },
            plugins: {
              legend: {
                position: 'top',
                labels: {
                  color: '#5eead4',
                  boxWidth: 14,
                  boxHeight: 14,
                  padding: 16,
                  font: { size: 13, weight: '600' }
                }
              },
              tooltip: {
                callbacks: {
                  label: function(context){
                    return context.dataset.label + ': ' + fmtTok(context.parsed.y || 0);
                  }
                }
              }
            }
          }
        });
        requestAnimationFrame(function(){
          if(usageChartInstance && typeof usageChartInstance.resize === 'function'){
            usageChartInstance.resize();
          }
        });
      }

      async function refreshUsageChartAndRuns(){
        const rangeEl = document.getElementById('usageChartRange');
        const bucketEl = document.getElementById('usageChartBucket');
        const projEl = document.getElementById('usageFilterProject');
        const modelEl = document.getElementById('usageFilterModel');
        const srcEl = document.getElementById('usageFilterSource');
        const range = (rangeEl && rangeEl.value) || '7d';
        const bucket = (bucketEl && bucketEl.value) || 'day';
        const projectPath = (projEl && projEl.value) || '';
        const model = (modelEl && modelEl.value) || '';
        const source = (srcEl && srcEl.value) || '';
        const qs = new URLSearchParams({ range: range, bucket: bucket });
        if(projectPath){ qs.set('projectPath', projectPath); }
        if(model){ qs.set('model', model); }
        if(source){ qs.set('source', source); }
        const ts = await fetch(withToken('/api/usage/timeseries?' + qs.toString())).then((r) => r.json());
        if(ts.ok){
          renderUsageChart(ts);
        } else {
          destroyUsageChart();
        }
        const qsRuns = new URLSearchParams({ limit: '50' });
        if(projectPath){ qsRuns.set('projectPath', projectPath); }
        if(model){ qsRuns.set('model', model); }
        if(source){ qsRuns.set('source', source); }
        const runsRes = await fetch(withToken('/api/usage/runs?' + qsRuns.toString())).then((r) => r.json());
        const tbody = document.getElementById('usageRunsBody');
        if(!tbody){ return; }
        if(!runsRes.ok){
          tbody.innerHTML = '<tr><td colspan="7" class="muted small">Runs unavailable.</td></tr>';
          return;
        }
        if(!runsRes.runs || runsRes.runs.length === 0){
          tbody.innerHTML = '<tr><td colspan="7" class="muted small">No recorded runs yet.</td></tr>';
          return;
        }
        tbody.innerHTML = runsRes.runs.map(function(row){
          const esc = function(s){
            return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\"/g,'&quot;');
          };
          return '<tr>' +
            '<td class="small">' + esc((row.startedAt || '').replace('T',' ').slice(0,19)) + '</td>' +
            '<td class="small" title="' + esc(row.projectPath) + '">' + esc(row.projectName) + '</td>' +
            '<td class="small muted">' + esc(row.model || row.modelPref || '—') + '</td>' +
            '<td class="small usageTokIn">' + fmtTok(row.inputTokens) + '</td>' +
            '<td class="small usageTokOut">' + fmtTok(row.outputTokens) + '</td>' +
            '<td class="small usageCost">' + fmtMoney(row.costUsd) + '</td>' +
            '<td class="small">' + esc(row.status) + '</td>' +
            '</tr>';
        }).join('');
      }

      async function refreshUsageDashboard(){
        const status = await fetch(withToken('/api/usage/status')).then((r) => r.json());
        const unavail = document.getElementById('usageUnavailable');
        const wrap = document.getElementById('usageMainWrap');
        const hint = document.getElementById('usageDbHint');
        if(!status.available){
          if(unavail){
            unavail.style.display = 'block';
            unavail.textContent = 'Usage database unavailable: ' + (status.reason || 'unknown');
          }
          if(wrap){ wrap.style.display = 'none'; }
          if(hint){ hint.style.display = 'none'; }
          return;
        }
        if(unavail){ unavail.style.display = 'none'; }
        if(wrap){ wrap.style.display = ''; }
        if(hint){ hint.style.display = ''; }

        const sum = await fetch(withToken('/api/usage/summary?range=all')).then((r) => r.json());
        if(!sum.ok){
          if(unavail){
            unavail.style.display = 'block';
            unavail.textContent = 'Usage summary unavailable: ' + (sum.reason || '');
          }
          if(wrap){ wrap.style.display = 'none'; }
          return;
        }
        document.getElementById('usageKpiTodayIn').textContent = fmtTok(sum.today.inputTokens);
        document.getElementById('usageKpiTodayOut').textContent = fmtTok(sum.today.outputTokens);
        document.getElementById('usageKpiLifeIn').textContent = fmtTok(sum.lifetime.inputTokens);
        document.getElementById('usageKpiLifeOut').textContent = fmtTok(sum.lifetime.outputTokens);
        document.getElementById('usageKpiRunsToday').textContent = String(sum.today.runs);
        document.getElementById('usageKpiCostLife').textContent = fmtMoney(sum.lifetime.costUsd);

        const filt = await fetch(withToken('/api/usage/filters')).then((r) => r.json());
        if(filt.ok){
          populateUsageSelect('usageFilterProject', filt.projects, 'path', function(p){ return p.name + ' — ' + p.path; }, true);
          populateUsageSelect('usageFilterModel', (filt.models || []).map(function(m){ return { model: m }; }), 'model', function(p){ return p.model; }, true);
          populateUsageSelect('usageFilterSource', (filt.sources || []).map(function(s){ return { source: s }; }), 'source', function(p){ return p.source; }, true);
        }
        await refreshUsageChartAndRuns();
      }

      async function refreshSystemInfo() {
        try {
          const sys = await fetch(withToken('/api/system')).then(r => r.json());
          document.getElementById('sysPlatform').textContent = sys.platform + ' (' + sys.arch + ')';
          document.getElementById('sysCpus').textContent = String(sys.cpus);
          document.getElementById('sysMemFree').textContent = Math.round(sys.freeMem / 1024 / 1024 / 1024) + ' / ' + Math.round(sys.totalMem / 1024 / 1024 / 1024) + ' GB';
          
          const uptimeSec = Math.round(sys.uptime);
          const hrs = Math.floor(uptimeSec / 3600);
          const mins = Math.floor((uptimeSec % 3600) / 60);
          document.getElementById('sysUptime').textContent = hrs + 'h ' + mins + 'm';
          document.getElementById('sysCpuModel').textContent = sys.cpuModel;
          document.getElementById('sysNode').textContent = sys.nodeVersion || '-';
          document.getElementById('sysLoadAvg').textContent = Array.isArray(sys.loadAvg) ? sys.loadAvg.map(v => Number(v).toFixed(2)).join(' / ') : '-';
          document.getElementById('sysRefreshedAt').textContent = 'Updated ' + new Date().toLocaleTimeString();
        } catch (e) {
          console.error('Failed to fetch system info', e);
        }
      }

      function formatRelativeTime(isoText) {
        const ts = Date.parse(isoText || '');
        if (!Number.isFinite(ts)) {
          return 'unknown';
        }
        const deltaSec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
        if (deltaSec < 60) return deltaSec + 's ago';
        const mins = Math.floor(deltaSec / 60);
        if (mins < 60) return mins + 'm ago';
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return hrs + 'h ago';
        const days = Math.floor(hrs / 24);
        if (days < 30) return days + 'd ago';
        const months = Math.floor(days / 30);
        return months + 'mo ago';
      }

      function fmtBytes(n) {
        const x = Number(n) || 0;
        if (x < 1024) {
          return String(x) + ' B';
        }
        if (x < 1024 * 1024) {
          return (x / 1024).toFixed(1) + ' KB';
        }
        if (x < 1024 * 1024 * 1024) {
          return (x / 1024 / 1024).toFixed(1) + ' MB';
        }
        return (x / 1024 / 1024 / 1024).toFixed(2) + ' GB';
      }
      function escAttr(s) {
        return String(s == null ? '' : s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/"/g, '&quot;');
      }

      async function refreshLastAgentPanel() {
        const el = document.getElementById('lastRunContent');
        if (!el) { return; }
        el.textContent = 'Loading…';
        try {
          const d = await fetch(withToken('/api/dashboard/last-agent-run')).then((r) => r.json());
          if (d && d.run) {
            const r = d.run;
            const ms = r.durationMs;
            let dur = '—';
            if (ms != null && Number.isFinite(ms)) {
              if (ms < 60000) {
                dur = String(Math.max(0, Math.round(ms / 1000))) + 's';
              } else {
                const m = Math.floor(ms / 60000);
                const s = Math.round((ms % 60000) / 1000);
                dur = m + 'm ' + s + 's';
              }
            }
            const model = (r.model || r.modelPref || '—');
            const status = (r.status || '—');
            const ex = (r.exitCode == null) ? '—' : String(r.exitCode);
            const tok = (fmtTok(r.inputTokens || 0) + ' / ' + fmtTok(r.outputTokens || 0));
            const started = (r.startedAt || '').replace('T', ' ').slice(0, 19);
            const prev = (r.promptPreview || '').slice(0, 120) + (r.promptPreview && r.promptPreview.length > 120 ? '…' : '');
            el.innerHTML =
              '<div class="metrics dashboardMetrics" style="margin-top:0">' +
              '<div class="metric"><div class="metricLabel">Status</div><div class="metricValue">' + escAttr(status) + '</div></div>' +
              '<div class="metric"><div class="metricLabel">Exit</div><div class="metricValue">' + escAttr(ex) + '</div></div>' +
              '<div class="metric"><div class="metricLabel">Model</div><div class="metricValue">' + escAttr(model) + '</div></div>' +
              '<div class="metric"><div class="metricLabel">Duration</div><div class="metricValue">' + escAttr(dur) + '</div></div>' +
              '<div class="metric"><div class="metricLabel">Tokens in/out</div><div class="metricValue">' + escAttr(tok) + '</div></div>' +
              '<div class="metric"><div class="metricLabel">Started</div><div class="metricValue">' + escAttr(started) + '</div></div>' +
              '</div>' +
              '<p class="hint" style="margin-top:6px">Project: <code>' + escAttr(r.projectPath) + '</code><br/>' +
              'Transcripts: <code>' + escAttr(d.transcriptBase || '—') + '</code> · run id: <code>' + escAttr(r.id) + '</code></p>' +
              (prev ? ('<p class="small muted" style="margin:0">Prompt: ' + escAttr(prev) + '</p>') : '');
            return;
          }
          if (d && d.ok === false && d.reason) {
            el.innerHTML = '<span class="muted">Database: ' + escAttr(d.reason) + '</span>';
            return;
          }
          el.innerHTML = '<span class="muted">No completed agent runs in the local usage log yet. Start a run from the Agent tab to record it.</span>';
        } catch (e) {
          el.textContent = 'Could not load last agent run.';
        }
      }

      async function refreshDiskDashboard() {
        const c = document.getElementById('diskContent');
        const note = document.getElementById('diskNote');
        const at = document.getElementById('diskMeasuredAt');
        const btn = document.getElementById('diskRefreshBtn');
        if (!c) { return; }
        if (btn) { btn.disabled = true; }
        c.textContent = 'Measuring (may take a minute on large projects)…';
        if (at) { at.textContent = ''; }
        if (note) { note.style.display = 'none'; }
        try {
          const d = await fetch(withToken('/api/dashboard/disk')).then((r) => r.json());
          if (d && d.ok) {
            const totL = d.volume && d.volume.ok && d.volume.totalBytes ? fmtBytes(d.volume.totalBytes) : '—';
            const freeL = d.volume && d.volume.ok ? fmtBytes(d.volume.freeBytes) : '—';
            const pvol = d.volume && d.volume.path ? d.volume.path : '—';
            if (d.note && note) {
              note.textContent = d.note;
              note.style.display = 'block';
            } else if (note) {
              note.style.display = 'none';
            }
            if (d.measuredAt && at) {
              const t = d.measuredAt.replace('T', ' ').slice(0, 19);
              at.textContent = 'Updated ' + t;
            }
            const rows = (d.projects || []).map(function (p) {
              const tag = p.truncated ? ' (est.)' : '';
              return '<tr><td class="small">' + escAttr(p.name) + '</td><td class="small">' + escAttr(p.path) + '</td><td class="small">' + escAttr(fmtBytes(p.sizeBytes)) + tag + '</td></tr>';
            }).join('');
            c.innerHTML =
              '<p class="small" style="margin:0 0 8px 0">Volume of workspace: <code>' + escAttr(pvol) + '</code> — free ' + escAttr(freeL) + (totL !== '—' ? (' / ' + escAttr(totL) + ' total') : '') + '</p>' +
              (d.workspaceRoot ? ('<p class="hint" style="margin:0 0 6px 0">Workspace: <code>' + escAttr(d.workspaceRoot) + '</code></p>') : '') +
              (rows
                ? ('<div style="overflow:auto;border:1px solid var(--line);border-radius:var(--radius-sm);max-height:180px"><table class="usageTable"><thead><tr><th>Project</th><th>Path</th><th>Size (latest)</th></tr></thead><tbody>' + rows + '</tbody></table></div>')
                : '<p class="muted">No projects registered. Use a folder with a <code>.winnow</code> directory.</p>');
          } else {
            c.textContent = (d && d.error) ? d.error : 'Disk info unavailable';
          }
        } catch (e) {
          c.textContent = 'Failed to load disk information.';
        } finally {
          if (btn) { btn.disabled = false; }
        }
      }

      function renderProjects(projects) {
        const list = document.getElementById('projectList');
        const filter = (document.getElementById('projectFilter')?.value || '').trim().toLowerCase();
        const rows = (projects || []).filter((p) => {
          if (!filter) return true;
          return String(p.name || '').toLowerCase().includes(filter) || String(p.path || '').toLowerCase().includes(filter);
        });
        document.getElementById('projectCountBadge').textContent = rows.length + (rows.length === 1 ? ' project' : ' projects');
        if (rows.length === 0) {
          list.innerHTML = '<div class="muted small" style="padding:12px">No projects match the current filter.</div>';
          return;
        }
        list.innerHTML = rows.map((p) =>
          '<button class="projectCard" type="button">' +
            '<div class="projectMain">' +
              '<div class="projectName">' + (p.name || '(unnamed)') + '</div>' +
              '<div class="projectPath">' + (p.path || '') + '</div>' +
            '</div>' +
            '<div class="projectTime" title="' + String(p.lastOpened || '').replace(/"/g, '&quot;') + '">' + formatRelativeTime(p.lastOpened) + '</div>' +
          '</button>'
        ).join('');
      }

      let allProjects = [];
      async function refreshProjects() {
        try {
          const data = await fetch(withToken('/api/projects')).then(r => r.json());
          if (!data.projects || data.projects.length === 0) {
            allProjects = [];
            document.getElementById('projectCountBadge').textContent = '0 projects';
            document.getElementById('projectList').innerHTML = '<div class="muted small" style="padding:12px">No registered projects found. Run winnow in a directory with a .winnow folder to register it.</div>';
            return;
          }
          allProjects = data.projects;
          renderProjects(allProjects);
        } catch (e) {
          console.error('Failed to fetch projects', e);
        }
      }

      async function refresh(){
        const state = await fetch(withToken('/api/state')).then(r=>r.json());
        document.getElementById('status').textContent = JSON.stringify(state,null,2);
        document.getElementById('backend').value = state.backend;
        document.getElementById('model').value = state.model;
        const logs = await fetch(withToken('/api/logs?limit=60')).then(r=>r.json());
        document.getElementById('logs').textContent = (logs.logs || []).join('\\n') || 'No logs yet';
        await refreshWorkspaceCwd();
      }
      async function refreshWorkspaceCwd(){
        const data = await fetch(withToken('/api/workspace/cwd')).then(r=>r.json());
        const inp = document.getElementById('workspacePathInput');
        if(inp){ inp.value = data.cwd || ''; }
        const hint = document.getElementById('workspaceCwdHint');
        if(hint){
          hint.textContent = 'transcripts: ' + (data.transcriptDir || '') + ' | launched: ' + (data.launchRoot || '');
        }
      }
      async function setWorkspaceCwd(){
        const inp = document.getElementById('workspacePathInput');
        const path = (inp && inp.value || '').trim();
        if(!path){
          document.getElementById('result').textContent = 'Enter a path.';
          return;
        }
        const res = await fetch(withToken('/api/workspace/cwd'),{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({path})
        }).then(r=>r.json());
        document.getElementById('result').textContent = JSON.stringify(res,null,2);
        if(res.ok){
          await refreshWorkspaceCwd();
          await refreshDir();
          await refreshWorkspace();
          await refreshSessions();
          await refreshProjects();
        }
      }
      async function resetWorkspaceCwd(){
        const res = await fetch(withToken('/api/workspace/cwd'),{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({reset:true})
        }).then(r=>r.json());
        document.getElementById('result').textContent = JSON.stringify(res,null,2);
        if(res.ok){
          await refreshWorkspaceCwd();
          await refreshDir();
          await refreshWorkspace();
          await refreshSessions();
          await refreshProjects();
        }
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
      let agentStartAbort = null;
      let agentStartInFlight = false;
      let agentSessionRunning = false;
      let agentFlavorTimer = null;
      let agentFlavorIndex = 0;
      const AGENT_RUN_FLAVOR = [
        "Gathering context from your workspace…",
        "Reasoning through the next steps…",
        "Tracing dependencies and side effects…",
        "Composing a careful patch…",
        "Double-checking edge cases…",
        "Almost there — still working…",
      ];
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
          if (msg.id) {
            seenTimelineIds.add(msg.id);
          }
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
        const root = document.getElementById("chatHistory");
        if (root) root.scrollTop = root.scrollHeight;
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

      async function refreshEnvEditor(){
        const root = document.getElementById('envFields');
        const hint = document.getElementById('envSaveHint');
        if(!root){ return; }
        root.innerHTML = 'Loading…';
        if(hint){ hint.textContent = ''; }
        try {
          const data = await fetch(withToken('/api/env')).then((r) => r.json());
          if(!data.ok){
            root.textContent = data.error || 'Failed to load env';
            return;
          }
          root.innerHTML = '';
          for(const e of data.entries || []){
            const row = document.createElement('div');
            row.className = 'env-row';
            const lab = document.createElement('label');
            lab.setAttribute('for', 'env_' + e.key);
            lab.textContent = e.key + (e.description ? ' — ' + e.description : '');
            const inp = document.createElement('input');
            inp.id = 'env_' + e.key;
            inp.dataset.envKey = e.key;
            inp.autocomplete = 'off';
            if(e.sensitive){
              inp.type = 'password';
              inp.placeholder = e.hasValue ? 'Leave blank to keep existing value' : 'Paste API key';
              inp.value = '';
            } else {
              inp.type = 'text';
              inp.value = e.value || '';
            }
            row.appendChild(lab);
            row.appendChild(inp);
            root.appendChild(row);
          }
        } catch(err){
          root.textContent = (err && err.message) ? err.message : String(err);
        }
      }

      async function saveEnvFromForm(){
        const hint = document.getElementById('envSaveHint');
        const values = {};
        document.querySelectorAll('#envFields input[data-env-key]').forEach((inp) => {
          values[inp.dataset.envKey] = inp.value;
        });
        try {
          const res = await fetch(withToken('/api/env'),{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ values }),
          }).then((r) => r.json());
          if(!res.ok){
            if(hint){ hint.textContent = res.error || JSON.stringify(res); }
            return;
          }
          if(hint){ hint.textContent = res.message || 'Saved.'; }
          await refreshEnvEditor();
        } catch(err){
          if(hint){ hint.textContent = (err && err.message) ? err.message : String(err); }
        }
      }

      function setView(view){
        if(usageRefreshTimer){
          clearInterval(usageRefreshTimer);
          usageRefreshTimer = null;
        }
        document.querySelectorAll('.tab').forEach((tab) => {
          tab.classList.toggle('active', tab.getAttribute('data-view') === view);
        });
        const body = document.querySelector('.body');
        const leftCol = document.querySelector('.leftCol');
        const rightCol = document.querySelector('.rightCol');
        const allPanels = document.querySelectorAll('.leftCol .panel, .rightCol .panel');
        
        // Reset visibility
        body.classList.remove('single');
        body.classList.remove('dashboard-mode');
        leftCol.style.display = '';
        rightCol.style.display = '';
        allPanels.forEach((el) => el.style.display = '');
        
        const dashboardOnly = document.querySelectorAll('.dashboard-only');
        const agentOnly = document.querySelectorAll('.agent-only');
        const settingsOnly = document.querySelectorAll('.settings-only');

        if (view === 'os') {
          // Dashboard mode should only render dashboard panels.
          allPanels.forEach((el) => el.style.display = 'none');
          dashboardOnly.forEach(el => el.style.display = '');
          settingsOnly.forEach(el => el.style.display = 'none');
          rightCol.style.display = 'none';
          body.classList.add('single');
          body.classList.add('dashboard-mode');
          refreshSystemInfo();
          void refreshLastAgentPanel();
          void refreshDiskDashboard();
          refreshProjects();
          refreshUsageDashboard();
          usageRefreshTimer = setInterval(refreshUsageDashboard, 15000);
        } else if (view === 'agent') {
          dashboardOnly.forEach(el => el.style.display = 'none');
          agentOnly.forEach(el => el.style.display = '');
          settingsOnly.forEach(el => el.style.display = 'none');
        } else if(view === 'settings'){
          body.classList.add('single');
          rightCol.style.display = 'none';
          dashboardOnly.forEach(el => el.style.display = 'none');
          agentOnly.forEach(el => el.style.display = 'none');
          settingsOnly.forEach(el => el.style.display = '');
          void refreshEnvEditor();
        }
      }
      if(EMBED_MODE){
        const topbar = document.querySelector('.topbar');
        if(topbar){ topbar.style.display = 'none'; }
      }
      function playSound(type) {
        try {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext) return;
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          if (type === 'success') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
            osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.1); // E5
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.3);
          } else {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(150, ctx.currentTime);
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.4);
          }
        } catch (e) {
          // ignore
        }
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
        if(streamDead && s.status !== 'running' && Array.isArray(s.events)){
          for(const ev of s.events){
            appendFromTimelineEvent(ev);
          }
        }
        if(s.status !== 'running' && pollTimer){
          clearInterval(pollTimer);
          pollTimer = null;
          playSound(s.status === 'done' ? 'success' : 'error');
        }
        if(s.status !== 'running'){
          agentSessionRunning = false;
          applyAgentRunUi();
        } else {
          agentSessionRunning = true;
          applyAgentRunUi();
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
          const st = data.status || 'running';
          agentSessionRunning = st === 'running';
          applyAgentRunUi();
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
      function clearAgentFlavorTimer(){
        if(agentFlavorTimer){
          clearInterval(agentFlavorTimer);
          agentFlavorTimer = null;
        }
      }
      function tickAgentFlavor(){
        const el = document.getElementById('agentRunFlavorText');
        if(!el){ return; }
        agentFlavorIndex = (agentFlavorIndex + 1) % AGENT_RUN_FLAVOR.length;
        el.textContent = AGENT_RUN_FLAVOR[agentFlavorIndex];
      }
      function applyAgentRunUi(){
        const locked = agentStartInFlight || agentSessionRunning;
        document.querySelectorAll('[data-agent-run]').forEach((b) => {
          b.disabled = locked;
          b.textContent = locked ? 'Running' : 'Run';
        });
        document.querySelectorAll('.agent-run-wrap').forEach((w) => { w.classList.toggle('is-busy', locked); });
        const ta = document.getElementById('agentPrompt');
        if(ta){
          ta.disabled = locked;
        }
        const banner = document.getElementById('agentRunLoadingBanner');
        const cancelBtn = document.getElementById('btnAgentRunCancel');
        if(banner){
          banner.classList.toggle('is-visible', locked);
          banner.setAttribute('aria-hidden', locked ? 'false' : 'true');
        }
        if(locked){
          const flavorEl = document.getElementById('agentRunFlavorText');
          if(flavorEl){
            flavorEl.textContent = AGENT_RUN_FLAVOR[agentFlavorIndex % AGENT_RUN_FLAVOR.length];
          }
          if(!agentFlavorTimer){
            agentFlavorTimer = setInterval(tickAgentFlavor, 2800);
          }
        } else {
          clearAgentFlavorTimer();
          agentFlavorIndex = 0;
        }
        if(cancelBtn){
          cancelBtn.disabled = false;
        }
      }
      async function cancelAgentRun(){
        if(agentStartInFlight && agentStartAbort){
          agentStartAbort.abort();
          return;
        }
        if(!agentSessionRunning || !activeSessionId){
          return;
        }
        const cancelBtn = document.getElementById('btnAgentRunCancel');
        if(cancelBtn){
          cancelBtn.disabled = true;
        }
        try{
          const httpRes = await fetch(withToken('/api/agent/' + activeSessionId + '/stop'), { method: 'POST' });
          const data = await httpRes.json();
          if(data && data.ok && data.stopped){
            appendChat('system', 'Stop requested — winding down the agent process.');
          } else if(data && data.ok){
            appendChat('system', 'Stop was ignored (session may already be idle).');
          } else {
            appendChat('system', 'Stop failed: ' + JSON.stringify(data));
          }
        } catch(err){
          appendChat('system', 'Stop failed: ' + ((err && err.message) ? err.message : String(err)));
        } finally {
          if(cancelBtn){
            cancelBtn.disabled = false;
          }
        }
      }
      async function startAgentRun(){
        const prompt = document.getElementById('agentPrompt').value.trim();
        if(!prompt){
          appendChat('system', 'Prompt is required.');
          return;
        }
        const busyGate = document.querySelector('[data-agent-run]');
        if(busyGate && busyGate.disabled){
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
          sessionId: resumeSessionId || undefined,
        };
        agentStartAbort = new AbortController();
        agentStartInFlight = true;
        applyAgentRunUi();
        let res = null;
        try {
          const httpRes = await fetch(withToken('/api/agent/start'),{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(payload),
            signal: agentStartAbort.signal,
          });
          res = await httpRes.json();
          if(res && res.ok === true){
            agentSessionRunning = true;
          }
        } catch(err){
          const name = err && err.name ? err.name : '';
          if(name === 'AbortError'){
            appendChat('system', 'Start cancelled.');
            return;
          }
          appendChat('system', 'Failed to start: ' + ((err && err.message) ? err.message : String(err)));
          return;
        } finally {
          agentStartInFlight = false;
          agentStartAbort = null;
          applyAgentRunUi();
        }
        if(!res || !res.ok){
          agentSessionRunning = false;
          applyAgentRunUi();
          appendChat('system', 'Failed to start: ' + JSON.stringify(res));
          return;
        }
        activeSessionId = res.sessionId;
        clearPrompt();
        if(continueMode){
          selectedResumeSessionId = activeSessionId;
        } else {
          clearChat();
        }
        thinkingEvents = [];
        lastTraceAtMs = Date.now();
        const block = document.getElementById('agentThinking');
        if (block) block.textContent = "";
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
        // Refresh sidebar list but don't force a reload of the current session panel
        setTimeout(async () => {
          const data = await fetch(withToken('/api/sessions?limit=25')).then(r=>r.json());
          updateResumeSelect(data.sessions || []);
          const rows = (data.sessions || []).map((s, idx) => {
            const isSelected = s.id === activeSessionId;
            const style = isSelected ? ' style="border:1px solid var(--accent)"' : '';
            const ts = (s.updatedAt || '').replace('T', ' ').slice(0, 19);
            return '<button type="button" class="entry sync-session" data-session-id="' + s.id + '"' + style + '>[' + ts + '] ' + String(s.id).slice(0, 8) + '  ' + (s.preview || '') + '</button>';
          }).join('');
          const listEl = document.getElementById('sessionList');
          if (listEl) {
            listEl.innerHTML = rows || '<span class="muted small">No transcript sessions found yet.</span>';
          }
          document.querySelectorAll('.sync-session').forEach(el => {
            const sid = el.getAttribute('data-session-id');
            el.onclick = () => loadSession(sid);
          });
        }, 500);
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
      refreshWorkspace();
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
      document.getElementById('btnSaveEnv')?.addEventListener('click', () => { void saveEnvFromForm(); });
      document.getElementById('btnReloadEnv')?.addEventListener('click', () => { void refreshEnvEditor(); });
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
          if(evt.target && evt.target.disabled){
            return;
          }
          evt.preventDefault();
          startAgentRun();
        }
      });
      const projectFilter = document.getElementById('projectFilter');
      if(projectFilter){
        projectFilter.addEventListener('input', () => renderProjects(allProjects));
      }
      ['usageChartRange','usageChartBucket','usageFilterProject','usageFilterModel','usageFilterSource','usageStacked'].forEach(function(id){
        const el = document.getElementById(id);
        if(el){
          el.addEventListener('change', function(){ void refreshUsageChartAndRuns(); });
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
