/**
 * Main grid (pane terminals) HTML served at `/main`.
 */
export function buildMainTerminalHtml(token?: string): string {
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
      .graphRoot { padding: 0 10px 10px; gap: 8px; }
      .graphToolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        padding-top: 6px;
      }
      .graphHint { margin: 0; font-size: 11px; flex-shrink: 0; }
      .graphPanel {
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        background: var(--bg);
        padding: 10px;
        overflow: auto;
        min-height: 0;
      }
      .graphCanvasWrap {
        position: relative;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        background: #02070b;
        min-height: 320px;
        overflow: auto;
      }
      .graphCanvasSvg {
        display: block;
        min-width: 100%;
        min-height: 320px;
      }
      .graphLegend {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        font-size: 11px;
        color: var(--muted);
      }
      .graphLegendItem {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--line-faint);
        border-radius: 99px;
        padding: 2px 8px;
        background: #000;
      }
      .graphLegendSwatch {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        display: inline-block;
      }
      .graphRecapList {
        margin: 0;
        padding-left: 18px;
        font-size: 12px;
      }
      .graphRecapList li { margin: 4px 0; }
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
          <span class="chip">2 agent · shell · docs · graph</span>
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
              <div class="paneTabs" role="tablist" aria-label="Agent UI, docs, graph, and system shell">
                <button type="button" class="paneTab paneTabActive" role="tab" aria-selected="true" data-pane2-tab="workspace" id="pane2TabWorkspace">Agent</button>
                <button type="button" class="paneTab" role="tab" aria-selected="false" data-pane2-tab="terminal" id="pane2TabTerminal">Shell</button>
                <button type="button" class="paneTab" role="tab" aria-selected="false" data-pane2-tab="docs" id="pane2TabDocs">Docs</button>
                <button type="button" class="paneTab" role="tab" aria-selected="false" data-pane2-tab="graph" id="pane2TabGraph">Graph</button>
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
            <div id="pane2Graph" class="pane2View isHidden graphRoot" aria-hidden="true">
              <div class="graphToolbar">
                <button type="button" class="reconnect" id="btnGraphRebuild">Rebuild Graph</button>
                <button type="button" class="reconnect" id="btnGraphReconcile">Manual Reconcile</button>
                <button type="button" class="reconnect" id="btnGraphApplyCorrection">Apply Correction</button>
                <button type="button" class="reconnect" id="btnGraphRecaps">Refresh Recaps</button>
              </div>
              <p id="graphHint" class="graphHint muted">Graph tab uses project graph APIs for rebuild, correction, and recap reports.</p>
              <div class="graphPanel">
                <pre id="graphSummary">Loading graph summary…</pre>
              </div>
              <div class="graphCanvasWrap">
                <svg id="graphCanvas" class="graphCanvasSvg" viewBox="0 0 1200 600" role="img" aria-label="Project graph"></svg>
              </div>
              <div id="graphLegend" class="graphLegend"></div>
              <div class="graphPanel">
                <div class="muted small" style="margin-bottom:6px">Recent recap reports</div>
                <ol id="graphRecapList" class="graphRecapList"></ol>
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
        if(!mount){ return; }
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
        const graphEl = document.getElementById("pane2Graph");
        const chip = document.getElementById("pane2ModeChip");
        const tw = document.getElementById("pane2TabWorkspace");
        const tt = document.getElementById("pane2TabTerminal");
        const td = document.getElementById("pane2TabDocs");
        const tg = document.getElementById("pane2TabGraph");
        const recon = document.getElementById("reconnectPane2");
        const isWs = mode === "workspace";
        const isTerm = mode === "terminal";
        const isDoc = mode === "docs";
        const isGraph = mode === "graph";
        if(wsEl && tsEl && docEl && graphEl){
          wsEl.classList.toggle("isHidden", !isWs);
          tsEl.classList.toggle("isHidden", !isTerm);
          docEl.classList.toggle("isHidden", !isDoc);
          graphEl.classList.toggle("isHidden", !isGraph);
          wsEl.setAttribute("aria-hidden", isWs ? "false" : "true");
          tsEl.setAttribute("aria-hidden", isTerm ? "false" : "true");
          docEl.setAttribute("aria-hidden", isDoc ? "false" : "true");
          graphEl.setAttribute("aria-hidden", isGraph ? "false" : "true");
        }
        if(chip){
          chip.textContent = isTerm ? "login shell" : isDoc ? "md · pdf" : isGraph ? "project graph" : "winnow-agent-ui";
        }
        if(tw && tt && td && tg){
          tw.classList.toggle("paneTabActive", isWs);
          tt.classList.toggle("paneTabActive", isTerm);
          td.classList.toggle("paneTabActive", isDoc);
          tg.classList.toggle("paneTabActive", isGraph);
          tw.setAttribute("aria-selected", isWs.toString());
          tt.setAttribute("aria-selected", isTerm.toString());
          td.setAttribute("aria-selected", isDoc.toString());
          tg.setAttribute("aria-selected", isGraph.toString());
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
        if(isGraph){
          void refreshGraphSummary();
          void refreshGraphRecaps();
          void refreshGraphErd();
        }
      }
      function escHtml(value){
        return String(value == null ? "" : value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }
      function nodeColor(kind){
        const map = {
          Project: "#67e8f9",
          Module: "#22d3ee",
          File: "#5eead4",
          Symbol: "#a7f3d0",
          Workflow: "#fca5a5",
          Concept: "#fda4af",
          DataEntity: "#ddd6fe",
        };
        return map[kind] || "#93c5fd";
      }
      function edgeColor(kind){
        const map = {
          contains: "rgba(34,211,238,0.45)",
          depends_on: "rgba(125,211,252,0.55)",
          calls: "rgba(94,234,212,0.62)",
          reads: "rgba(250,204,21,0.7)",
          writes: "rgba(248,113,113,0.7)",
          emits: "rgba(253,186,116,0.72)",
          drives: "rgba(251,146,60,0.65)",
          related_to: "rgba(196,181,253,0.72)",
        };
        return map[kind] || "rgba(125,211,252,0.4)";
      }
      function layoutErd(nodes){
        const kindOrder = ["Project","Module","File","Symbol","Workflow","Concept","DataEntity"];
        const byKind = new Map();
        nodes.forEach((n)=>{
          const key = n.kind || "Other";
          const arr = byKind.get(key) || [];
          arr.push(n);
          byKind.set(key, arr);
        });
        const orderedKinds = kindOrder.filter((k)=>byKind.has(k)).concat(
          Array.from(byKind.keys()).filter((k)=>!kindOrder.includes(k)).sort()
        );
        const colW = 260;
        const rowH = 110;
        const marginX = 24;
        const marginY = 24;
        const out = new Map();
        orderedKinds.forEach((kind, colIdx)=>{
          const rows = byKind.get(kind) || [];
          rows.sort((a,b)=>String(a.name || a.id).localeCompare(String(b.name || b.id)));
          rows.forEach((node, rowIdx)=>{
            out.set(node.id, {
              x: marginX + colIdx * colW,
              y: marginY + rowIdx * rowH,
              w: 210,
              h: 70,
            });
          });
        });
        const maxRows = Math.max(1, ...Array.from(byKind.values()).map((arr)=>arr.length));
        const width = Math.max(1200, marginX * 2 + orderedKinds.length * colW);
        const height = Math.max(600, marginY * 2 + maxRows * rowH);
        return { positions: out, width, height };
      }
      function renderGraphErd(nodes, edges){
        const svg = document.getElementById("graphCanvas");
        const legend = document.getElementById("graphLegend");
        if(!svg || !legend){ return; }
        if(!nodes || nodes.length === 0){
          svg.innerHTML = '<text x="24" y="40" fill="#7dd3fc" font-size="14">No graph nodes yet. Click "Rebuild Graph".</text>';
          legend.innerHTML = "";
          return;
        }
        const layout = layoutErd(nodes);
        svg.setAttribute("viewBox", "0 0 " + layout.width + " " + layout.height);
        svg.setAttribute("width", String(layout.width));
        svg.setAttribute("height", String(layout.height));
        const markerDefs =
          '<defs>' +
          '<marker id="graphArrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
          '<path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(125,211,252,0.7)"></path>' +
          '</marker>' +
          "</defs>";
        const edgeSvg = (edges || []).map((e)=>{
          const from = layout.positions.get(e.fromId);
          const to = layout.positions.get(e.toId);
          if(!from || !to){ return ""; }
          const sx = from.x + from.w;
          const sy = from.y + (from.h / 2);
          const tx = to.x;
          const ty = to.y + (to.h / 2);
          const cx1 = sx + Math.max(20, (tx - sx) * 0.4);
          const cx2 = tx - Math.max(20, (tx - sx) * 0.4);
          const d = "M " + sx + " " + sy + " C " + cx1 + " " + sy + ", " + cx2 + " " + ty + ", " + tx + " " + ty;
          return '<path d="' + d + '" stroke="' + edgeColor(e.kind) + '" stroke-width="1.6" fill="none" marker-end="url(#graphArrow)">' +
            "<title>" + escHtml((e.kind || "edge") + ": " + (e.fromId || "") + " -> " + (e.toId || "")) + "</title>" +
            "</path>";
        }).join("");
        const nodeSvg = nodes.map((n)=>{
          const p = layout.positions.get(n.id);
          if(!p){ return ""; }
          const title = escHtml(n.name || n.id);
          const subtitle = escHtml(n.kind || "Node");
          const path = escHtml(n.path || "");
          const fill = nodeColor(n.kind);
          return '<g>' +
            '<rect x="' + p.x + '" y="' + p.y + '" rx="8" ry="8" width="' + p.w + '" height="' + p.h + '" fill="#040b10" stroke="' + fill + '" stroke-width="1.4"></rect>' +
            '<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="20" fill="' + fill + '" fill-opacity="0.22"></rect>' +
            '<text x="' + (p.x + 8) + '" y="' + (p.y + 14) + '" fill="#67e8f9" font-size="11" font-family="ui-monospace, Menlo, monospace">' + subtitle + '</text>' +
            '<text x="' + (p.x + 8) + '" y="' + (p.y + 36) + '" fill="#e0f2fe" font-size="12" font-family="ui-sans-serif, system-ui">' + title.slice(0, 30) + '</text>' +
            '<text x="' + (p.x + 8) + '" y="' + (p.y + 54) + '" fill="#93c5fd" font-size="10" font-family="ui-monospace, Menlo, monospace">' + path.slice(0, 30) + '</text>' +
            '<title>' + title + (path ? (" | " + path) : "") + '</title>' +
            '</g>';
        }).join("");
        svg.innerHTML = markerDefs + '<g>' + edgeSvg + "</g>" + '<g>' + nodeSvg + "</g>";
        const kinds = Array.from(new Set(nodes.map((n)=>n.kind || "Other")));
        legend.innerHTML = kinds
          .sort()
          .map((kind)=>'<span class="graphLegendItem"><span class="graphLegendSwatch" style="background:' + nodeColor(kind) + '"></span>' + escHtml(kind) + "</span>")
          .join("");
      }
      async function refreshGraphErd(){
        const hint = document.getElementById("graphHint");
        try{
          const nodesRes = await fetch(withToken("/api/graph/nodes?limit=260")).then((r)=>r.json());
          const edgesRes = await fetch(withToken("/api/graph/edges?limit=700")).then((r)=>r.json());
          if(!nodesRes.ok || !edgesRes.ok){
            if(hint){ hint.textContent = "Graph visualization unavailable: " + ((nodesRes.error || edgesRes.error || "unknown")); }
            renderGraphErd([], []);
            return;
          }
          renderGraphErd(nodesRes.nodes || [], edgesRes.edges || []);
          if(hint){
            hint.textContent = "ERD view rendered with " + (nodesRes.nodes || []).length + " node(s) and " + (edgesRes.edges || []).length + " edge(s).";
          }
        } catch(err){
          if(hint){ hint.textContent = "Graph visualization failed: " + ((err && err.message) ? err.message : String(err)); }
          renderGraphErd([], []);
        }
      }
      async function refreshGraphSummary(){
        const out = document.getElementById("graphSummary");
        if(!out){ return; }
        try{
          const data = await fetch(withToken("/api/graph/summary")).then((r)=>r.json());
          if(!data.ok){
            out.textContent = "Failed to load graph summary: " + (data.error || "unknown");
            return;
          }
          out.textContent = JSON.stringify(data.summary || data, null, 2);
        } catch(err){
          out.textContent = (err && err.message) ? err.message : String(err);
        }
      }
      async function refreshGraphRecaps(){
        const root = document.getElementById("graphRecapList");
        if(!root){ return; }
        root.innerHTML = "";
        try{
          const data = await fetch(withToken("/api/graph/recaps?limit=20")).then((r)=>r.json());
          if(!data.ok){
            root.innerHTML = "<li>Failed to load recap reports.</li>";
            return;
          }
          const recaps = data.recaps || [];
          if(recaps.length === 0){
            root.innerHTML = "<li class='muted'>No recap reports yet.</li>";
            return;
          }
          root.innerHTML = recaps.map((r)=>{
            const findings = Array.isArray(r.findings) ? r.findings.length : 0;
            return "<li><strong>" + (r.status || "ok") + "</strong> [" + (r.source || "unknown") + "] " + (r.ts || "") + " — " + findings + " finding(s)</li>";
          }).join("");
        } catch(err){
          root.innerHTML = "<li>" + ((err && err.message) ? err.message : String(err)) + "</li>";
        }
      }
      async function triggerGraphRebuild(){
        const hint = document.getElementById("graphHint");
        if(hint){ hint.textContent = "Rebuilding graph..."; }
        try{
          const data = await fetch(withToken("/api/graph/rebuild"), { method: "POST" }).then((r)=>r.json());
          if(hint){ hint.textContent = data.ok ? "Graph rebuilt." : ("Rebuild failed: " + (data.error || "unknown")); }
        } catch(err){
          if(hint){ hint.textContent = "Rebuild failed: " + ((err && err.message) ? err.message : String(err)); }
        }
        await refreshGraphSummary();
        await refreshGraphRecaps();
        await refreshGraphErd();
      }
      async function triggerGraphReconcile(){
        const hint = document.getElementById("graphHint");
        if(hint){ hint.textContent = "Manual reconcile in progress..."; }
        try{
          const data = await fetch(withToken("/api/graph/reconcile"), { method: "POST" }).then((r)=>r.json());
          if(hint){ hint.textContent = data.ok ? ("Reconcile complete: " + (data.report && data.report.status ? data.report.status : "ok")) : ("Reconcile failed: " + (data.error || "unknown")); }
        } catch(err){
          if(hint){ hint.textContent = "Reconcile failed: " + ((err && err.message) ? err.message : String(err)); }
        }
        await refreshGraphRecaps();
      }
      async function applyGraphCorrectionPrompt(){
        const hint = document.getElementById("graphHint");
        const raw = prompt(
          "Enter correction JSON. Example:\\n" +
          "{ \\\"operations\\\": [{ \\\"type\\\": \\\"lock_edge\\\", \\\"edgeId\\\": \\\"file::...::depends_on::file::...\\\" }] }",
          '{ "operations": [] }'
        );
        if(raw == null){ return; }
        let payload;
        try{
          payload = JSON.parse(raw);
        } catch(_e){
          if(hint){ hint.textContent = "Invalid JSON. Correction not applied."; }
          return;
        }
        if(hint){ hint.textContent = "Applying correction..."; }
        try{
          const data = await fetch(withToken("/api/graph/corrections"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }).then((r)=>r.json());
          if(hint){
            hint.textContent = data.ok
              ? ("Applied " + (data.applied || 0) + " correction(s). Recap: " + ((data.report && data.report.status) || "ok"))
              : ("Correction failed: " + (data.error || "unknown"));
          }
        } catch(err){
          if(hint){ hint.textContent = "Correction failed: " + ((err && err.message) ? err.message : String(err)); }
        }
        await refreshGraphSummary();
        await refreshGraphRecaps();
        await refreshGraphErd();
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
      document.getElementById("pane2TabGraph")?.addEventListener("click",()=>setPane2Tab("graph"));
      document.getElementById("btnDocsReindex")?.addEventListener("click",()=>{ void refreshDocsIndex(true); });
      document.getElementById("btnGraphRebuild")?.addEventListener("click",()=>{ void triggerGraphRebuild(); });
      document.getElementById("btnGraphReconcile")?.addEventListener("click",()=>{ void triggerGraphReconcile(); });
      document.getElementById("btnGraphApplyCorrection")?.addEventListener("click",()=>{ void applyGraphCorrectionPrompt(); });
      document.getElementById("btnGraphRecaps")?.addEventListener("click",()=>{ void refreshGraphRecaps(); });
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
      document.querySelectorAll(".reconnect[data-pane]").forEach((btn)=>{
        btn.addEventListener("click",()=>{
          const paneId = btn.getAttribute("data-pane");
          if(!paneId){ return; }
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
