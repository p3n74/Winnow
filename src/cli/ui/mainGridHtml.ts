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
        --panel2: #050505;
        --line: rgba(34, 211, 238, 0.32);
        --line-faint: rgba(34, 211, 238, 0.12);
        --text: #67e8f9;
        --text-strong: #22d3ee;
        --text-neon: #22d3ee;
        --muted: rgba(34, 211, 238, 0.7);
        --accent: #22d3ee;
        --accent-hover: #67e8f9;
        --red-pastel: #ff4d4d;
        --red-neon: #ff2d2d;
        --danger: #ff2d2d;
        --success: #22d3ee;
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
        background: var(--bg);
      }
      .docsMdRendered.isHidden,
      .docsPdfViewer.isHidden {
        display: none !important;
      }
      .graphRoot {
        padding: 0 10px 10px;
        gap: 8px;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .graphRoot.graphOverlayOpen {
        position: fixed;
        inset: 16px;
        z-index: 90;
        padding: 12px;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: rgba(0, 0, 0, 0.96);
        box-shadow: 0 0 0 1px var(--line-faint);
        animation: graphOverlayIn 180ms ease-out;
        backdrop-filter: blur(2px);
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        overflow: hidden;
      }
      @keyframes graphOverlayIn {
        from { opacity: 0; transform: translateY(8px) scale(0.995); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      body.graphOverlayActive { overflow: hidden; }
      .graphToolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        padding-top: 6px;
        position: sticky;
        top: 0;
        z-index: 2;
        background: rgba(0,0,0,0.9);
        backdrop-filter: blur(2px);
        border-radius: 8px;
        padding: 8px;
        min-height: 0;
      }
      .graphToolbar .reconnect {
        transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease, border-color 120ms ease;
      }
      .graphToolbar .reconnect:hover {
        transform: translateY(-1px);
        border-color: var(--accent);
        box-shadow: 0 6px 18px rgba(34, 211, 238, 0.18);
      }
      .graphToolbar .reconnect:active { transform: translateY(0); }
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
        background: var(--bg);
        min-height: 320px;
        height: 100%;
        overflow: hidden;
        cursor: grab;
        touch-action: none;
        box-shadow: none;
      }
      .graphCanvasWrap:active {
        cursor: grabbing;
      }
      .graphWorkArea {
        display: grid;
        grid-template-columns: minmax(0, 1.7fr) minmax(320px, 0.85fr);
        gap: 10px;
        align-items: start;
        min-height: 0;
        height: 100%;
        overflow: hidden;
      }
      @media (max-width: 1300px) {
        .graphWorkArea {
          grid-template-columns: 1fr;
          grid-template-rows: minmax(0, 1fr) auto;
          overflow: auto;
        }
      }
      .graphHoverCard {
        position: absolute;
        display: none;
        z-index: 5;
        max-width: 320px;
        pointer-events: none;
        border: 1px solid var(--line);
        background: rgba(0, 0, 0, 0.97);
        color: var(--text);
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 11px;
        line-height: 1.4;
        box-shadow: 0 8px 24px rgba(0,0,0,0.35);
      }
      .graphNodeCard {
        transition: transform 120ms ease;
      }
      .graphNodeCard:hover {
        transform: translateY(-1px);
      }
      .graphNodeHotspot rect {
        cursor: pointer;
      }
      .graphCanvasSvg {
        display: block;
        min-width: 100%;
        min-height: 100%;
        transition: opacity 140ms ease, transform 140ms ease;
      }
      .graphCanvasSvg.isRefreshing {
        opacity: 0.68;
        transform: scale(0.997);
      }
      .graphLegend {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        font-size: 11px;
        color: var(--muted);
        margin-top: 2px;
        padding: 2px 2px 0;
      }
      .graphExplorerPanel {
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        background: rgba(0, 0, 0, 0.92);
        backdrop-filter: none;
        padding: 10px;
        font-size: 12px;
        box-shadow: none;
        height: 100%;
        max-height: 100%;
        overflow-y: auto;
        transition: transform 180ms ease, opacity 180ms ease, border-color 180ms ease;
        transform: translateX(8px);
        opacity: 0.92;
        min-height: 0;
      }
      .graphExplorerPanel.open {
        transform: translateX(0);
        opacity: 1;
        border-color: rgba(34,211,238,0.45);
      }
      @media (max-width: 1300px) {
        .graphExplorerPanel {
          max-height: 40vh;
          height: auto;
        }
      }
      .graphExplorerTitle {
        font-size: 12px;
        color: var(--text-neon);
        margin: 0 0 6px 0;
      }
      .graphExplorerMuted {
        color: var(--muted);
        margin: 0 0 8px 0;
      }
      .graphFnList {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 6px;
      }
      .graphFnBtn {
        width: 100%;
        text-align: left;
        border: 1px solid var(--line-faint);
        border-radius: 6px;
        background: var(--bg);
        color: var(--text);
        padding: 6px 8px;
        cursor: pointer;
        font-size: 12px;
        transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
      }
      .graphFnBtn:hover {
        border-color: var(--accent);
        transform: translateY(-1px);
      }
      .graphFnBtn.active {
        border-color: var(--accent);
        background: rgba(34, 211, 238, 0.12);
      }
      .graphExplorerActions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
        flex-wrap: wrap;
      }
      .graphFilterInput {
        width: 100%;
        border: 1px solid rgba(34,211,238,0.3);
        border-radius: 8px;
        padding: 7px 10px;
        background: rgba(0, 0, 0, 0.82);
        color: var(--text);
        outline: none;
        margin-bottom: 8px;
      }
      .graphFilterInput:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 2px rgba(34,211,238,0.2);
      }
      .graphFnMetaRow {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .graphFnName {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .graphTag {
        border: 1px solid rgba(34,211,238,0.28);
        border-radius: 999px;
        padding: 1px 7px;
        font-size: 10px;
        color: var(--text);
        background: rgba(0, 0, 0, 0.65);
      }
      .graphFnSub {
        margin-top: 4px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }
      .graphJumpBtn {
        border: 1px solid rgba(34,211,238,0.35);
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.82);
        color: var(--text);
        font-size: 10px;
        padding: 2px 7px;
        cursor: pointer;
      }
      .graphJumpBtn:hover {
        border-color: rgba(34,211,238,0.7);
      }
      .graphBreadcrumb {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--text);
        border: 1px solid rgba(34,211,238,0.25);
        border-radius: 999px;
        padding: 4px 9px;
        background: rgba(0, 0, 0, 0.55);
      }
      .graphNodeDimmed {
        opacity: 0.28;
      }
      .graphNodePulse {
        animation: graphPulse 900ms ease-in-out infinite;
      }
      @keyframes graphPulse {
        0%,100% { filter: drop-shadow(0 0 0 rgba(34,211,238,0)); }
        50% { filter: drop-shadow(0 0 8px rgba(34,211,238,0.45)); }
      }
      .graphLegendItem {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--line-faint);
        border-radius: 99px;
        padding: 2px 8px;
        background: rgba(0, 0, 0, 0.95);
        transition: border-color 120ms ease, transform 120ms ease;
      }
      .graphLegendItem:hover {
        border-color: rgba(125, 211, 252, 0.45);
        transform: translateY(-1px);
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
      .graphTextBlock { margin: 0; line-height: 1.55; color: var(--text); white-space: pre-wrap; font-size: 12px; }
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
            <div id="pane2Workspace" class="pane2View" aria-hidden="false">
              <iframe
                class="cursorHost"
                title="Winnow Agent workspace"
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
                <button type="button" class="reconnect" id="btnGraphRebuild">Rebuild & Re-evaluate</button>
                <button type="button" class="reconnect" id="btnGraphReconcile">Manual Reconcile</button>
                <button type="button" class="reconnect" id="btnGraphApplyCorrection">Apply Correction</button>
                <button type="button" class="reconnect" id="btnGraphViewTechnical">Technical View</button>
                <button type="button" class="reconnect" id="btnGraphViewBusiness">Business Logic View</button>
                <button type="button" class="reconnect" id="btnGraphViewBusinessGoal">Business Goal Layer</button>
                <button type="button" class="reconnect" id="btnGraphFitView">Fit View</button>
                <button type="button" class="reconnect" id="btnGraphOverlayClose">Close Graph</button>
              </div>
              <p id="graphHint" class="graphHint muted">Graph overlay provides a high-level project map plus a heuristic lookup index for targeted concept/file navigation.</p>
              <div class="graphWorkArea">
                <div>
                  <div class="graphCanvasWrap">
                    <svg id="graphCanvas" class="graphCanvasSvg" viewBox="0 0 1200 600" role="img" aria-label="Project graph"></svg>
                    <div id="graphHoverCard" class="graphHoverCard"></div>
                  </div>
                  <div id="graphLegend" class="graphLegend"></div>
                </div>
                <div id="graphExplorerPanel" class="graphExplorerPanel">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <h4 class="graphExplorerTitle" style="margin:0;">Technical explorer</h4>
                    <div style="display:flex; gap:6px;">
                      <button type="button" class="reconnect" id="btnGraphLocalDeps" disabled>Show local dependencies</button>
                    <button type="button" class="reconnect" id="btnGraphExternalDeps" disabled>Show external dependencies</button>
                      <button type="button" class="graphJumpBtn" id="btnGraphBack" style="display:none;">Back</button>
                      <button type="button" class="graphJumpBtn" id="btnGraphFocusReset" disabled>Reset</button>
                      <button type="button" class="graphJumpBtn" id="btnGraphExit">Exit</button>
                    </div>
                  </div>
                  <p id="graphExplorerHint" class="graphExplorerMuted">Click a file node in Technical View to list functions.</p>
                  <div id="graphSelectedFile" class="graphBreadcrumb" style="display:none"></div>
                  <input id="graphFunctionFilter" class="graphFilterInput" type="text" placeholder="Filter functions..." />
                  <ul id="graphFunctionList" class="graphFnList"></ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.7/dist/purify.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
    <script src="https://unpkg.com/@xterm/xterm/lib/xterm.js"></script>
    <script src="https://unpkg.com/@xterm/addon-fit/lib/addon-fit.js"></script>
    <script>
      const AUTH_TOKEN = ${JSON.stringify(token ?? "")};
      let graphViewMode = "technical";
      let pane2Mode = "workspace";
      let graphOverlayOpen = false;
      let graphSimulation = null;
      let graphSimState = { hoveredNodeId: null, selectedNodeId: null, lastInteractionTs: 0 };
      let graphDragState = { active: false, nodeId: null, pinOnRelease: false };
      let graphNodeCache = { nodes: [], edges: [] };
      let graphViewBox = { x: 0, y: 0, w: 1200, h: 600, baseW: 1200, baseH: 600 };
      let graphDrag = { active: false, startX: 0, startY: 0, initX: 0, initY: 0 };
      let graphFocusState = {
        fileNodeId: null,
        fileNodeName: "",
        fileNodePath: "",
        functionNodeId: null,
        localDeps: false,
        externalSeedIds: [],
        hoveredFunctionNodeId: null,
        functions: [],
        displayNodes: [],
        displayEdges: [],
      };
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
          theme:{background:"#000000",foreground:"#67e8f9",cursor:"#22d3ee", selectionBackground: "rgba(34, 211, 238, 0.28)"}
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
          theme:{background:"#000000",foreground:"#67e8f9",cursor:"#22d3ee", selectionBackground: "rgba(34, 211, 238, 0.28)"}
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
        pane2Mode = mode;
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
          chip.textContent = isWs ? "winnow-agent-ui" : isTerm ? "shell" : isDoc ? "md · pdf" : "project graph";
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
      function openGraphOverlay(){
        const graphEl = document.getElementById("pane2Graph");
        const hint = document.getElementById("graphHint");
        if(!graphEl){ return; }
        graphOverlayOpen = true;
        graphEl.classList.remove("isHidden");
        graphEl.classList.add("graphOverlayOpen");
        graphEl.setAttribute("aria-hidden", "false");
        document.body.classList.add("graphOverlayActive");
        if(hint){ hint.textContent = "Graph overlay opened. Main grid state is unchanged."; }
        void refreshGraphErd();
      }
      function closeGraphOverlay(){
        const graphEl = document.getElementById("pane2Graph");
        if(!graphEl){ return; }
        graphOverlayOpen = false;
        graphEl.classList.remove("graphOverlayOpen");
        document.body.classList.remove("graphOverlayActive");
        if(pane2Mode !== "graph"){
          graphEl.classList.add("isHidden");
          graphEl.setAttribute("aria-hidden", "true");
        }
      }
      function applyGraphViewBox(w, h){
        const svg = document.getElementById("graphCanvas");
        if(!svg) return;
        if(w !== undefined && h !== undefined){
          graphViewBox.x = 0;
          graphViewBox.y = 0;
          graphViewBox.w = w;
          graphViewBox.h = h;
          graphViewBox.baseW = w;
          graphViewBox.baseH = h;
        }
        svg.setAttribute("viewBox", graphViewBox.x + " " + graphViewBox.y + " " + graphViewBox.w + " " + graphViewBox.h);
        svg.style.width = "100%";
        svg.style.height = "100%";
        svg.removeAttribute("width");
        svg.removeAttribute("height");
      }
      function fitGraphViewToRenderedNodes(nodeIds, padding){
        const svg = document.getElementById("graphCanvas");
        if(!svg || !Array.isArray(nodeIds) || nodeIds.length === 0){ return; }
        const pad = typeof padding === "number" ? padding : 90;
        const ids = new Set(nodeIds.filter(Boolean));
        const rects = Array.from(svg.querySelectorAll(".graphNodeCard"))
          .filter((el)=>ids.has(el.getAttribute("data-node-id") || ""))
          .map((el)=>el.querySelector("rect"))
          .filter(Boolean);
        if(rects.length === 0){ return; }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        rects.forEach((r)=>{
          const x = Number(r.getAttribute("x") || "0");
          const y = Number(r.getAttribute("y") || "0");
          const w = Number(r.getAttribute("width") || "0");
          const h = Number(r.getAttribute("height") || "0");
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + w);
          maxY = Math.max(maxY, y + h);
        });
        if(!Number.isFinite(minX) || !Number.isFinite(minY)){ return; }
        graphViewBox.x = minX - pad;
        graphViewBox.y = minY - pad;
        graphViewBox.w = Math.max(420, (maxX - minX) + pad * 2);
        graphViewBox.h = Math.max(280, (maxY - minY) + pad * 2);
        applyGraphViewBox();
      }
      
      function initGraphCanvasInteractions(){
        const wrap = document.querySelector(".graphCanvasWrap");
        if(!wrap) return;
        wrap.addEventListener("mousedown", (e) => {
          graphDrag.active = true;
          graphDrag.startX = e.clientX;
          graphDrag.startY = e.clientY;
          graphDrag.initX = graphViewBox.x;
          graphDrag.initY = graphViewBox.y;
        });
        window.addEventListener("mousemove", (e) => {
          if(!graphDrag.active) return;
          const svg = document.getElementById("graphCanvas");
          if(!svg) return;
          const rect = svg.getBoundingClientRect();
          const scaleX = graphViewBox.w / rect.width;
          const scaleY = graphViewBox.h / rect.height;
          const dx = (e.clientX - graphDrag.startX) * scaleX;
          const dy = (e.clientY - graphDrag.startY) * scaleY;
          graphViewBox.x = graphDrag.initX - dx;
          graphViewBox.y = graphDrag.initY - dy;
          applyGraphViewBox();
        });
        window.addEventListener("mouseup", () => {
          graphDrag.active = false;
        });
        wrap.addEventListener("wheel", (e) => {
          e.preventDefault();
          const svg = document.getElementById("graphCanvas");
          if(!svg) return;
          const rect = svg.getBoundingClientRect();
          
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          
          const svgX = graphViewBox.x + (mouseX / rect.width) * graphViewBox.w;
          const svgY = graphViewBox.y + (mouseY / rect.height) * graphViewBox.h;
          
          const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
          
          graphViewBox.w *= zoomFactor;
          graphViewBox.h *= zoomFactor;
          
          graphViewBox.x = svgX - (mouseX / rect.width) * graphViewBox.w;
          graphViewBox.y = svgY - (mouseY / rect.height) * graphViewBox.h;
          
          applyGraphViewBox();
        }, { passive: false });
      }

      function resetGraphExplorerState(){
        window.__graphSelectedFnId = "";
        graphFocusState = {
          fileNodeId: null,
          fileNodeName: "",
          fileNodePath: "",
          functionNodeId: null,
          localDeps: false,
          externalSeedIds: [],
          hoveredFunctionNodeId: null,
          functions: [],
          displayNodes: [],
          displayEdges: [],
        };
        const hint = document.getElementById("graphExplorerHint");
        const file = document.getElementById("graphSelectedFile");
        const list = document.getElementById("graphFunctionList");
        const filter = document.getElementById("graphFunctionFilter");
        const panel = document.getElementById("graphExplorerPanel");
        const depsBtn = document.getElementById("btnGraphLocalDeps");
        const extBtn = document.getElementById("btnGraphExternalDeps");
        const resetBtn = document.getElementById("btnGraphFocusReset");
        const backBtn = document.getElementById("btnGraphBack");
        if(hint){ hint.textContent = "Click a file node in Technical View to list functions."; }
        if(file){ file.textContent = ""; file.style.display = "none"; }
        if(list){ list.innerHTML = ""; }
        if(filter){ filter.value = ""; }
        if(depsBtn){
          depsBtn.textContent = "Show local dependencies";
          depsBtn.disabled = true;
        }
        if(extBtn){ extBtn.disabled = true; }
        if(resetBtn){ resetBtn.disabled = true; }
        if(backBtn){ backBtn.style.display = "none"; }
        if(panel){ panel.classList.remove("open"); }
      }
      function parseFunctionMeta(fn){
        const signature = String(fn.signature || "");
        const isAsync = /\basync\b/i.test(signature) || /\basync\b/i.test(String(fn.summaryEn || ""));
        const isExported = /\bexport\b/i.test(signature) || /\bentrypoint\b/i.test(String(fn.descriptionEn || ""));
        const argMatch = signature.match(/\(([^)]*)\)/);
        const argCount = argMatch && argMatch[1].trim()
          ? argMatch[1].split(",").map((s)=>s.trim()).filter(Boolean).length
          : 0;
        const complexity = Math.max(1, Math.min(10, 2 + argCount + (isAsync ? 1 : 0) + (String(fn.descriptionEn || "").length > 90 ? 1 : 0)));
        return { isAsync, isExported, complexity };
      }
      function renderFunctionList(){
        const list = document.getElementById("graphFunctionList");
        const filter = document.getElementById("graphFunctionFilter");
        const panel = document.getElementById("graphExplorerPanel");
        if(!list || !filter){ return; }
        const q = String(filter.value || "").trim().toLowerCase();
        const rows = (graphFocusState.functions || []).filter((fn)=>String(fn.name || "").toLowerCase().includes(q));
        if(!rows.length){
          list.innerHTML = "<li class='graphExplorerMuted'>No functions match this filter.</li>";
          return;
        }
        list.innerHTML = rows.map((fn)=>{
          const meta = parseFunctionMeta(fn);
          const icon = meta.isAsync ? "◷" : meta.isExported ? "↗" : "·";
          return (
            '<li>' +
              '<button type="button" class="graphFnBtn' + (graphFocusState.functionNodeId === fn.id ? " active" : "") + '" data-fn-id="' + escHtml(fn.id) + '">' +
                '<div class="graphFnMetaRow">' +
                  '<span class="graphFnName"><span>' + icon + '</span><span>' + escHtml(fn.name || fn.id) + '</span></span>' +
                  '<span class="graphTag">C' + meta.complexity + '</span>' +
                '</div>' +
                '<div class="graphFnSub">' +
                  '<span class="graphExplorerMuted">' + (meta.isExported ? "exported" : "local") + (meta.isAsync ? " · async" : "") + '</span>' +
                  '<span class="graphTag">' + (fn.signature ? String(fn.signature).slice(0, 26).replace(/"/g, "") : "helper") + '</span>' +
                '</div>' +
              '</button>' +
              '<div style="display:flex;justify-content:flex-end;margin-top:4px">' +
                '<button type="button" class="graphJumpBtn" data-jump-id="' + escHtml(fn.id) + '">Jump to Code</button>' +
              '</div>' +
            '</li>'
          );
        }).join("");
        list.querySelectorAll(".graphFnBtn").forEach((btn)=>{
          btn.addEventListener("click",()=>{
            const fnId = btn.getAttribute("data-fn-id");
            if(!fnId){ return; }
            graphFocusState.functionNodeId = fnId;
            window.__graphSelectedFnId = fnId;
            graphFocusState.localDeps = true;
            if(!graphFocusState.externalSeedIds.includes(fnId)){
              graphFocusState.externalSeedIds.push(fnId);
            }
            const depsBtn = document.getElementById("btnGraphLocalDeps");
            const extBtn = document.getElementById("btnGraphExternalDeps");
            const resetBtn = document.getElementById("btnGraphFocusReset");
            if(depsBtn){ depsBtn.textContent = "Hide local dependencies"; depsBtn.disabled = false; }
            if(extBtn){ extBtn.disabled = false; }
            if(resetBtn){ resetBtn.disabled = false; }
            renderFunctionList();
            rebuildFocusedGraphAndRender();
          });
          btn.addEventListener("mouseenter",()=>{
            const fileId = graphFocusState.fileNodeId;
            if(!fileId){ return; }
            graphFocusState.hoveredFunctionNodeId = btn.getAttribute("data-fn-id");
            const svgNode = document.querySelector('[data-node-id="' + CSS.escape(fileId) + '"]');
            if(svgNode){ svgNode.classList.add("graphNodePulse"); }
          });
          btn.addEventListener("mouseleave",()=>{
            graphFocusState.hoveredFunctionNodeId = null;
            const fileId = graphFocusState.fileNodeId;
            if(!fileId){ return; }
            const svgNode = document.querySelector('[data-node-id="' + CSS.escape(fileId) + '"]');
            if(svgNode){ svgNode.classList.remove("graphNodePulse"); }
          });
        });
        list.querySelectorAll(".graphJumpBtn").forEach((btn)=>{
          btn.addEventListener("click",(event)=>{
            event.stopPropagation();
            const fnId = btn.getAttribute("data-jump-id");
            const fn = (graphFocusState.functions || []).find((x)=>x.id === fnId);
            const path = graphFocusState.fileNodePath || "";
            if(path){
              fetch(withToken("/api/fs/open"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path })
              }).catch((err)=>console.error("[graph-jump] failed", err));
            }
          });
        });
      }
      function buildFileBreadcrumb(absPath){
        if(!absPath){ return ""; }
        const parts = String(absPath).split("/").filter(Boolean);
        const tail = parts.slice(-3);
        return tail.join(" > ");
      }
      function symbolFileRelFromId(symbolId){
        const raw = String(symbolId || "");
        if(!raw.startsWith("symbol::")){ return ""; }
        const rest = raw.slice("symbol::".length);
        const hashIdx = rest.indexOf("#");
        return hashIdx >= 0 ? rest.slice(0, hashIdx) : "";
      }
      function symbolFileNodeId(symbolId){
        const rel = symbolFileRelFromId(symbolId);
        return rel ? ("file::" + rel) : "";
      }
      function mergeGraphData(baseNodes, baseEdges, addNodes, addEdges){
        const nodeById = new Map((baseNodes || []).map((n)=>[n.id, n]));
        (addNodes || []).forEach((n)=>{ if(n && n.id && !nodeById.has(n.id)){ nodeById.set(n.id, n); } });
        const edgeById = new Map((baseEdges || []).map((e)=>[e.id, e]));
        (addEdges || []).forEach((e)=>{
          if(!e){ return; }
          const key = e.id || (e.fromId + "::" + e.kind + "::" + e.toId);
          if(!edgeById.has(key)){ edgeById.set(key, { ...e, id: key }); }
        });
        return { nodes: Array.from(nodeById.values()), edges: Array.from(edgeById.values()) };
      }
      function collectLocalDependencyData(selectedFnId){
        const nearNodes = graphNodeCache.nodes || [];
        const nearEdges = graphNodeCache.edges || [];
        const symbolNodes = nearNodes.filter((n)=>n && n.kind === "Symbol");
        const byId = new Map(symbolNodes.map((n)=>[n.id, n]));
        const callEdges = nearEdges.filter((e)=>
          (e.kind === "calls" || e.kind === "consumes") &&
          (e.fromId === selectedFnId || e.toId === selectedFnId) &&
          byId.has(e.fromId) && byId.has(e.toId)
        );
        const depIds = new Set([selectedFnId]);
        callEdges.forEach((e)=>{ depIds.add(e.fromId); depIds.add(e.toId); });
        const depNodes = symbolNodes.filter((n)=>depIds.has(n.id));
        return { nodes: depNodes, edges: callEdges };
      }
      function collectExternalDependencyData(seedFnId){
        const allNodes = graphNodeCache.nodes || [];
        const allEdges = graphNodeCache.edges || [];
        const byId = new Map(allNodes.map((n)=>[n.id, n]));
        const seedNode = byId.get(seedFnId);
        if(!seedNode){ return { nodes: [], edges: [] }; }
        const seedFileRel = symbolFileRelFromId(seedFnId);
        const relationEdges = allEdges.filter((e)=>
          (e.kind === "calls" || e.kind === "consumes") &&
          (e.fromId === seedFnId || e.toId === seedFnId)
        );
        const externalSymbolIds = new Set();
        relationEdges.forEach((e)=>{
          const other = e.fromId === seedFnId ? e.toId : e.fromId;
          const otherRel = symbolFileRelFromId(other);
          if(otherRel && otherRel !== seedFileRel){ externalSymbolIds.add(other); }
        });
        const externalSymbols = Array.from(externalSymbolIds).map((id)=>byId.get(id)).filter(Boolean);
        const addNodes = [seedNode].concat(externalSymbols);
        const addEdges = relationEdges.filter((e)=>externalSymbolIds.has(e.fromId) || externalSymbolIds.has(e.toId));
        externalSymbols.forEach((sym)=>{
          const fileId = symbolFileNodeId(sym.id);
          const fileNode = byId.get(fileId);
          if(fileNode){ addNodes.push(fileNode); }
          const hasContain = allEdges.some((e)=>e.kind === "contains" && e.fromId === fileId && e.toId === sym.id);
          if(hasContain){
            const contain = allEdges.find((e)=>e.kind === "contains" && e.fromId === fileId && e.toId === sym.id);
            if(contain){ addEdges.push(contain); }
          } else if(fileId){
            addEdges.push({
              id: fileId + "::contains::" + sym.id,
              fromId: fileId,
              toId: sym.id,
              kind: "contains",
              summaryEn: "File contains symbol",
            });
          }
        });
        return { nodes: addNodes, edges: addEdges };
      }
      function bindFocusedSymbolSelection(displayNodes){
        const svg = document.getElementById("graphCanvas");
        const focusHint = document.getElementById("graphExplorerHint");
        if(!svg){ return; }
        const byId = new Map((displayNodes || []).map((n)=>[n.id, n]));
        svg.querySelectorAll(".graphNodeHotspot").forEach((el)=>{
          el.addEventListener("click",()=>{
            const nodeId = el.getAttribute("data-node-id") || "";
            const node = byId.get(nodeId);
            if(!node || node.kind !== "Symbol"){ return; }
            graphFocusState.functionNodeId = node.id;
            window.__graphSelectedFnId = node.id;
            graphFocusState.localDeps = true;
            if(!graphFocusState.externalSeedIds.includes(node.id)){
              graphFocusState.externalSeedIds.push(node.id);
            }
            const extBtn = document.getElementById("btnGraphExternalDeps");
            if(extBtn){ extBtn.disabled = false; }
            if(focusHint){
              focusHint.textContent = "Selected function " + (node.name || node.id) + ". Auto-expanded local + one-degree external dependencies.";
            }
            rebuildFocusedGraphAndRender();
          });
        });
      }
      function rebuildFocusedGraphAndRender(){
        if(!graphFocusState.fileNodeId || !graphFocusState.functionNodeId){ return; }
        const byId = new Map((graphNodeCache.nodes || []).map((n)=>[n.id, n]));
        const selectedFile = byId.get(graphFocusState.fileNodeId);
        const selectedFn = byId.get(graphFocusState.functionNodeId);
        if(!selectedFile || !selectedFn){ return; }
        let merged = mergeGraphData(
          [selectedFile, selectedFn],
          [{
            id: selectedFile.id + "::contains::" + selectedFn.id,
            fromId: selectedFile.id,
            toId: selectedFn.id,
            kind: "contains",
            summaryEn: "File contains selected function",
          }],
          [],
          [],
        );
        if(graphFocusState.localDeps){
          const local = collectLocalDependencyData(selectedFn.id);
          merged = mergeGraphData(merged.nodes, merged.edges, local.nodes, local.edges);
        }
        (graphFocusState.externalSeedIds || []).forEach((seedId)=>{
          const ext = collectExternalDependencyData(seedId);
          merged = mergeGraphData(merged.nodes, merged.edges, ext.nodes, ext.edges);
        });
        graphFocusState.displayNodes = merged.nodes;
        graphFocusState.displayEdges = merged.edges;
        renderGraphErd(merged.nodes, merged.edges);
        bindFocusedSymbolSelection(merged.nodes);
        setTimeout(()=>{
          const focusIds = (merged.nodes || []).filter((n)=>n && (n.kind === "File" || n.kind === "Symbol")).map((n)=>n.id);
          fitGraphViewToRenderedNodes(focusIds, graphFocusState.localDeps ? 120 : 100);
        }, 0);
      }
      function computeAncestorPath(fileNodeId, nodes, edges){
        const byId = new Map((nodes || []).map((n)=>[n.id, n]));
        const parentEdgeByChild = new Map();
        (edges || []).forEach((e)=>{
          if(e.kind === "contains" && byId.has(e.fromId) && byId.has(e.toId)){
            parentEdgeByChild.set(e.toId, e);
          }
        });
        const nodeIds = new Set([fileNodeId]);
        const edgeIds = new Set();
        let cur = fileNodeId;
        while(parentEdgeByChild.has(cur)){
          const e = parentEdgeByChild.get(cur);
          edgeIds.add(e.id);
          nodeIds.add(e.fromId);
          cur = e.fromId;
        }
        return { nodeIds, edgeIds };
      }
      async function loadFunctionsForFile(fileNodeId, fileNodeName){
        const hint = document.getElementById("graphExplorerHint");
        const file = document.getElementById("graphSelectedFile");
        const list = document.getElementById("graphFunctionList");
        const filter = document.getElementById("graphFunctionFilter");
        const panel = document.getElementById("graphExplorerPanel");
        const depsBtn = document.getElementById("btnGraphLocalDeps");
        const resetBtn = document.getElementById("btnGraphFocusReset");
        const backBtn = document.getElementById("btnGraphBack");
        if(!list){ return; }
        const fileNode = (graphNodeCache.nodes || []).find((n)=>n.id === fileNodeId);
        graphFocusState.fileNodeId = fileNodeId;
        graphFocusState.fileNodeName = fileNodeName || "";
        graphFocusState.fileNodePath = fileNode && fileNode.path ? String(fileNode.path) : "";
        graphFocusState.functionNodeId = null;
        graphFocusState.localDeps = false;
        graphFocusState.externalSeedIds = [];
        graphFocusState.functions = [];
        if(panel){ panel.classList.add("open"); }
        if(backBtn){ backBtn.style.display = "inline-block"; }
        if(resetBtn){ resetBtn.disabled = true; }
        if(file){
          file.textContent = buildFileBreadcrumb(graphFocusState.fileNodePath || fileNodeName);
          file.style.display = "inline-flex";
        }
        if(hint){ hint.textContent = "Loading functions from selected file..."; }
        list.innerHTML = "";
        if(filter){ filter.value = ""; }
        try{
          const res = await fetch(withToken("/api/graph/node/" + encodeURIComponent(fileNodeId) + "/neighbors")).then((r)=>r.json());
          if(!res.ok){
            if(hint){ hint.textContent = "Failed to load file functions: " + (res.error || "unknown"); }
            return;
          }
          const nodes = res.nodes || [];
          const edges = res.edges || [];

          // Merge into global cache for focus view lookup
          const existingNodeIds = new Set((graphNodeCache.nodes || []).map((n)=>n.id));
          nodes.forEach((n)=>{ if(n && !existingNodeIds.has(n.id)){ graphNodeCache.nodes.push(n); } });
          const existingEdgeIds = new Set((graphNodeCache.edges || []).map((e)=>e.id));
          edges.forEach((e)=>{ if(e && !existingEdgeIds.has(e.id)){ graphNodeCache.edges.push(e); } });

          const byId = new Map(nodes.map((n)=>[n.id, n]));
          const functions = edges
            .filter((e)=>e.kind === "contains" && e.fromId === fileNodeId)
            .map((e)=>byId.get(e.toId))
            .filter((n)=>n && n.kind === "Symbol");
          if(!functions.length){
            if(hint){ hint.textContent = "No function symbols found for this file."; }
            list.innerHTML = "<li class='graphExplorerMuted'>No functions detected.</li>";
            return;
          }
          functions.sort((a,b)=>String(a.name || a.id).localeCompare(String(b.name || b.id)));
          graphFocusState.functions = functions;
          renderFunctionList();
          if(filter){
            filter.oninput = ()=>renderFunctionList();
          }
          const pathCtx = computeAncestorPath(fileNodeId, graphNodeCache.nodes, graphNodeCache.edges);
          const svg = document.getElementById("graphCanvas");
          if(svg){
            svg.querySelectorAll(".graphNodeCard, .graphEdgePath").forEach((el)=>el.classList.remove("graphNodeDimmed"));
            svg.querySelectorAll(".graphNodeCard").forEach((el)=>{
              const id = el.getAttribute("data-node-id");
              if(!id || pathCtx.nodeIds.has(id)){ return; }
              el.classList.add("graphNodeDimmed");
            });
            svg.querySelectorAll(".graphEdgePath").forEach((el)=>{
              const id = el.getAttribute("data-edge-id");
              if(!id || pathCtx.edgeIds.has(id)){ return; }
              el.classList.add("graphNodeDimmed");
            });
          }
          if(hint){ hint.textContent = "Select a function to focus graph on file -> function."; }
        } catch(err){
          if(hint){ hint.textContent = "Failed to load file functions: " + ((err && err.message) ? err.message : String(err)); }
        }
      }
      async function renderTechnicalFocusGraph(){
        if(!graphFocusState.fileNodeId || !graphFocusState.functionNodeId){ return; }
        window.__graphSelectedFnId = graphFocusState.functionNodeId;
        const hint = document.getElementById("graphHint");
        const focusHint = document.getElementById("graphExplorerHint");
        const svg = document.getElementById("graphCanvas");
        const legend = document.getElementById("graphLegend");
        if(!svg || !legend){ return; }
        const selectedFile = graphNodeCache.nodes.find((n)=>n.id === graphFocusState.fileNodeId);
        const selectedFn = graphNodeCache.nodes.find((n)=>n.id === graphFocusState.functionNodeId);
        if(!selectedFile || !selectedFn){
          if(focusHint){ focusHint.textContent = "Focused nodes are missing. Try rebuilding graph."; }
          return;
        }
        rebuildFocusedGraphAndRender();
        if(hint){
          hint.textContent = graphFocusState.localDeps
            ? "Focused view: file + function + local dependencies (arrows show direction)."
            : "Focused view: selected file and function.";
        }
        if(focusHint){
          focusHint.textContent = graphFocusState.localDeps
            ? "Connection types: Invokes, Invoked By, Consumes Output Of, Provides Output To. External one-degree links are included for selected seeds."
            : "Use 'Show local dependencies' to expand connected local functions.";
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
          File: "#22d3ee",
          Symbol: "#67e8f9",
          Workflow: "#ff2d2d",
          Concept: "#ff4d4d",
          DataEntity: "#22d3ee",
        };
        return map[kind] || "#22d3ee";
      }
      function edgeColor(kind){
        const map = {
          contains: "rgba(34,211,238,0.45)",
          depends_on: "rgba(34,211,238,0.55)",
          calls: "rgba(34,211,238,0.62)",
          consumes: "rgba(34,211,238,0.78)",
          reads: "rgba(34,211,238,0.7)",
          writes: "rgba(255,45,45,0.7)",
          emits: "rgba(34,211,238,0.72)",
          drives: "rgba(255,45,45,0.65)",
          related_to: "rgba(34,211,238,0.72)",
        };
        return map[kind] || "rgba(34,211,238,0.4)";
      }
      function nodeSizeByKind(kind){
        if(kind === "File"){ return { w: 230, h: 72 }; }
        if(kind === "Symbol"){ return { w: 220, h: 68 }; }
        if(kind === "Module"){ return { w: 210, h: 64 }; }
        return { w: 210, h: 64 };
      }
      function nodeLane(kind){
        if(kind === "Project"){ return 0; }
        if(kind === "Module"){ return 1; }
        if(kind === "File"){ return 2; }
        if(kind === "Symbol"){ return 3; }
        if(kind === "Workflow" || kind === "Concept"){ return 4; }
        return 5;
      }
      function rectBoundaryPoint(node, tx, ty){
        const cx = node.x || 0;
        const cy = node.y || 0;
        const hw = (node.w || 200) / 2;
        const hh = (node.h || 64) / 2;
        const dx = tx - cx;
        const dy = ty - cy;
        if(dx === 0 && dy === 0){ return { x: cx, y: cy }; }
        const sx = Math.abs(dx) / hw;
        const sy = Math.abs(dy) / hh;
        const s = Math.max(sx, sy);
        return { x: cx + dx / s, y: cy + dy / s };
      }
      function edgePathWithRouting(source, target, edgeIdx){
        const sp = rectBoundaryPoint(source, target.x || 0, target.y || 0);
        const tp = rectBoundaryPoint(target, source.x || 0, source.y || 0);
        const mx = (sp.x + tp.x) / 2;
        const my = (sp.y + tp.y) / 2;
        const dx = tp.x - sp.x;
        const dy = tp.y - sp.y;
        const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const nx = -dy / len;
        const ny = dx / len;
        const baseOffset = Math.min(56, Math.max(18, len * 0.12));
        const signedOffset = baseOffset * ((edgeIdx % 2 === 0 ? 1 : -1) * (1 + Math.floor(edgeIdx / 2) * 0.35));
        const cx = mx + nx * signedOffset;
        const cy = my + ny * signedOffset;
        const d = "M " + sp.x + " " + sp.y + " Q " + cx + " " + cy + " " + tp.x + " " + tp.y;
        return { d, sp, tp, cx, cy, mx, my };
      }
      function parseEdgeConnectionLabel(edge){
        if(edge.kind === "calls"){
          return edge.fromId === (window.__graphSelectedFnId || "") ? "Invokes" : "Invoked By";
        }
        if(edge.kind === "consumes"){
          return edge.fromId === (window.__graphSelectedFnId || "") ? "Consumes Output Of" : "Provides Output To";
        }
        return "";
      }
      function stopGraphSimulation(){
        if(graphSimulation){
          try { graphSimulation.stop(); } catch(_e){}
          graphSimulation = null;
        }
      }
      function setupHoverForce(graph){
        let simNodes = [];
        const adjacency = new Map();
        (graph.edges || []).forEach((e)=>{
          if(!adjacency.has(e.fromId)){ adjacency.set(e.fromId, new Set()); }
          if(!adjacency.has(e.toId)){ adjacency.set(e.toId, new Set()); }
          adjacency.get(e.fromId).add(e.toId);
          adjacency.get(e.toId).add(e.fromId);
        });
        function force(alpha){
          if(!graphSimState.hoveredNodeId){ return; }
          const hoveredId = graphSimState.hoveredNodeId;
          const neigh = adjacency.get(hoveredId);
          if(!neigh || neigh.size === 0){ return; }
          const center = simNodes.find((n)=>n.id === hoveredId);
          if(!center){ return; }
          simNodes.forEach((n)=>{
            if(!neigh.has(n.id)){ return; }
            const dx = (center.x || 0) - (n.x || 0);
            const dy = (center.y || 0) - (n.y || 0);
            n.vx = (n.vx || 0) + dx * alpha * 0.02;
            n.vy = (n.vy || 0) + dy * alpha * 0.02;
          });
        }
        force.initialize = function(nodes){ simNodes = nodes; };
        return force;
      }
      function setupBoundsForce(width, height){
        let simNodes = [];
        function force(){
          const pad = 36;
          for(const n of simNodes){
            const hw = (n.w || 200) / 2;
            const hh = (n.h || 64) / 2;
            if((n.x || 0) < pad + hw) n.x = pad + hw;
            if((n.y || 0) < pad + hh) n.y = pad + hh;
            if((n.x || 0) > width - pad - hw) n.x = width - pad - hw;
            if((n.y || 0) > height - pad - hh) n.y = height - pad - hh;
          }
        }
        force.initialize = function(nodes){ simNodes = nodes; };
        return force;
      }
      function renderGraphErdStatic(nodes, edges){
        const svg = document.getElementById("graphCanvas");
        const legend = document.getElementById("graphLegend");
        const hoverCard = document.getElementById("graphHoverCard");
        if(!svg || !legend){ return; }
        if(hoverCard){ hoverCard.style.display = "none"; }
        if(!nodes || nodes.length === 0){
          svg.innerHTML = '<text x="24" y="40" fill="#67e8f9" font-size="14">No graph nodes yet. Click "Rebuild Graph".</text>';
          legend.innerHTML = "";
          return;
        }
        const layout = layoutErd(nodes);
        applyGraphViewBox(layout.width, layout.height);
        const markerDefs =
          '<defs>' +
          '<marker id="graphArrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
          '<path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(34,211,238,0.82)"></path>' +
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
          return '<path class="graphEdgePath" data-edge-id="' + escHtml(e.id || "") + '" d="' + d + '" stroke="' + edgeColor(e.kind) + '" stroke-width="1.6" fill="none" marker-end="url(#graphArrow)"></path>';
        }).join("");
        const nodeSvg = nodes.map((n)=>{
          const p = layout.positions.get(n.id);
          if(!p){ return ""; }
          const title = escHtml(n.name || n.id);
          const subtitle = escHtml(n.kind || "Node");
          const summary = escHtml((n.descriptionEn || n.summaryEn || "No overview available.").slice(0, 220));
          const fill = nodeColor(n.kind);
          return '<g class="graphNodeCard" data-node-id="' + escHtml(n.id || "") + '">' +
            '<rect x="' + p.x + '" y="' + p.y + '" rx="8" ry="8" width="' + p.w + '" height="' + p.h + '" fill="#000000" stroke="' + fill + '" stroke-width="1.4"></rect>' +
            '<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="20" fill="' + fill + '" fill-opacity="0.22"></rect>' +
            '<text x="' + (p.x + 8) + '" y="' + (p.y + 14) + '" fill="#67e8f9" font-size="11" font-family="ui-monospace, Menlo, monospace">' + subtitle + '</text>' +
            '<text x="' + (p.x + 8) + '" y="' + (p.y + 36) + '" fill="#67e8f9" font-size="12" font-family="ui-sans-serif, system-ui">' + title.slice(0, 30) + '</text>' +
            '<g class="graphNodeHotspot" data-summary="' + summary + '" data-node="' + title + '" data-node-id="' + escHtml(n.id || "") + '">' +
            '<rect x="' + p.x + '" y="' + p.y + '" rx="8" ry="8" width="' + p.w + '" height="' + p.h + '" fill="transparent"></rect>' +
            '</g>' +
            '</g>';
        }).join("");
        svg.innerHTML = markerDefs + '<g>' + edgeSvg + '</g><g>' + nodeSvg + "</g>";
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
      function layoutTechnicalTree(nodes, edges){
        const byId = new Map();
        (nodes || []).forEach((n)=>byId.set(n.id, n));
        const childMap = new Map();
        const indegree = new Map();
        (nodes || []).forEach((n)=>{
          childMap.set(n.id, []);
          indegree.set(n.id, 0);
        });
        (edges || []).forEach((e)=>{
          if(e.kind !== "contains"){ return; }
          if(!byId.has(e.fromId) || !byId.has(e.toId)){ return; }
          const arr = childMap.get(e.fromId) || [];
          arr.push(e.toId);
          childMap.set(e.fromId, arr);
          indegree.set(e.toId, (indegree.get(e.toId) || 0) + 1);
        });
        childMap.forEach((arr)=>{
          arr.sort((a,b)=>{
            const na = byId.get(a);
            const nb = byId.get(b);
            return String((na && (na.name || na.id)) || a).localeCompare(String((nb && (nb.name || nb.id)) || b));
          });
        });
        const roots = (nodes || [])
          .filter((n)=>(indegree.get(n.id) || 0) === 0)
          .sort((a,b)=>String(a.name || a.id).localeCompare(String(b.name || b.id)));
        const ordered = [];
        const depthById = new Map();
        const seen = new Set();
        function visit(id, depth){
          if(seen.has(id)){ return; }
          seen.add(id);
          ordered.push(id);
          depthById.set(id, depth);
          const kids = childMap.get(id) || [];
          kids.forEach((k)=>visit(k, depth + 1));
        }
        roots.forEach((r)=>visit(r.id, 0));
        (nodes || []).forEach((n)=>{ if(!seen.has(n.id)){ visit(n.id, 0); } });

        const marginX = 36;
        const marginY = 26;
        const colW = 300;
        const rowH = 86;
        const boxW = 238;
        const boxH = 58;
        const positions = new Map();
        ordered.forEach((id, rowIdx)=>{
          const depth = depthById.get(id) || 0;
          positions.set(id, {
            x: marginX + depth * colW,
            y: marginY + rowIdx * rowH,
            w: boxW,
            h: boxH,
          });
        });
        let maxDepth = 0;
        depthById.forEach((d)=>{ if(d > maxDepth){ maxDepth = d; } });
        const width = Math.max(1200, marginX * 2 + (maxDepth + 1) * colW + boxW);
        const height = Math.max(600, marginY * 2 + Math.max(1, ordered.length) * rowH);
        return { positions, width, height };
      }
      function renderGraphErd(nodes, edges){
        const svg = document.getElementById("graphCanvas");
        const legend = document.getElementById("graphLegend");
        const hoverCard = document.getElementById("graphHoverCard");
        if(!svg || !legend){ return; }
        if(typeof d3 === "undefined" || !d3.forceSimulation){
          renderGraphErdStatic(nodes, edges);
          return;
        }
        stopGraphSimulation();
        if(hoverCard){ hoverCard.style.display = "none"; }
        if(!nodes || nodes.length === 0){
          svg.innerHTML = '<text x="24" y="40" fill="#67e8f9" font-size="14">No graph nodes yet. Click "Rebuild Graph".</text>';
          legend.innerHTML = "";
          return;
        }
        const width = Math.max(1200, Math.floor((svg.parentElement && svg.parentElement.clientWidth) || 1200));
        const height = Math.max(640, Math.floor((svg.parentElement && svg.parentElement.clientHeight) || 700));
        applyGraphViewBox(width, height);
        const simNodes = (nodes || []).map((n, i)=>{
          const size = nodeSizeByKind(n.kind);
          const theta = (i / Math.max(1, nodes.length)) * Math.PI * 2;
          return { ...n, w: size.w, h: size.h, x: width / 2 + Math.cos(theta) * (180 + i * 2), y: height / 2 + Math.sin(theta) * (160 + i * 2) };
        });
        const byId = new Map(simNodes.map((n)=>[n.id, n]));
        const simEdges = (edges || [])
          .filter((e)=>e && typeof e.fromId === "string" && typeof e.toId === "string")
          .filter((e)=>byId.has(e.fromId) && byId.has(e.toId))
          .map((e)=>({ ...e, source: e.fromId, target: e.toId }));

        function renderTick(){
          const markerDefs =
            '<defs>' +
            '<marker id="graphArrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
            '<path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(34,211,238,0.82)"></path>' +
            '</marker>' +
            "</defs>";
          const edgeLabelSvg = [];
          const edgeSvg = simEdges.map((e, idx)=>{
            const s = byId.get(e.fromId);
            const t = byId.get(e.toId);
            if(!s || !t){ return ""; }
            const routed = edgePathWithRouting(s, t, idx);
            const label = parseEdgeConnectionLabel(e);
            const hovered = graphSimState.hoveredNodeId;
            const selected = window.__graphSelectedFnId || "";
            const isEmphasized = Boolean(
              (hovered && (e.fromId === hovered || e.toId === hovered)) ||
              (selected && (e.fromId === selected || e.toId === selected))
            );
            if(label){
              const ang = Math.atan2(routed.tp.y - routed.sp.y, routed.tp.x - routed.sp.x) * (180 / Math.PI);
              edgeLabelSvg.push(
                '<g transform="translate(' + routed.mx + ' ' + routed.my + ') rotate(' + ang + ')">' +
                  '<rect x="-50" y="-10" width="100" height="14" rx="7" ry="7" fill="rgba(0,0,0,0.88)" stroke="rgba(34,211,238,0.28)"></rect>' +
                  '<text x="0" y="0" fill="#67e8f9" font-size="9" text-anchor="middle" font-family="ui-sans-serif, system-ui">' + escHtml(label) + '</text>' +
                '</g>'
              );
            }
            const edgeWidth = isEmphasized ? 2.2 : (e.kind === "contains" ? 1.2 : (e.kind === "calls" || e.kind === "consumes") ? 1.8 : 1.4);
            const edgeOpacity = isEmphasized ? 1 : (e.kind === "contains" ? 0.38 : 0.88);
            return '<path class="graphEdgePath" data-edge-id="' + escHtml(e.id || "") + '" d="' + routed.d + '" stroke="' + edgeColor(e.kind) + '" stroke-opacity="' + edgeOpacity + '" stroke-width="' + edgeWidth + '" fill="none" marker-end="url(#graphArrow)"></path>';
          }).join("");
          const nodeSvg = simNodes.map((n)=>{
            const x = (n.x || 0) - n.w / 2;
            const y = (n.y || 0) - n.h / 2;
            const title = escHtml(n.name || n.id);
            const subtitle = escHtml(n.kind || "Node");
            const summary = escHtml((n.descriptionEn || n.summaryEn || "No overview available.").slice(0, 220));
            const fill = nodeColor(n.kind);
            return '<g class="graphNodeCard" data-node-id="' + escHtml(n.id || "") + '">' +
              '<rect x="' + x + '" y="' + y + '" rx="8" ry="8" width="' + n.w + '" height="' + n.h + '" fill="#000000" stroke="' + fill + '" stroke-width="1.4"></rect>' +
              '<rect x="' + x + '" y="' + y + '" width="' + n.w + '" height="20" fill="' + fill + '" fill-opacity="0.22"></rect>' +
              '<text x="' + (x + 8) + '" y="' + (y + 14) + '" fill="#67e8f9" font-size="11" font-family="ui-monospace, Menlo, monospace">' + subtitle + '</text>' +
              '<text x="' + (x + 8) + '" y="' + (y + 36) + '" fill="#67e8f9" font-size="12" font-family="ui-sans-serif, system-ui">' + title.slice(0, 30) + '</text>' +
              '<g class="graphNodeHotspot" data-summary="' + summary + '" data-node="' + title + '" data-node-id="' + escHtml(n.id || "") + '" data-kind="' + escHtml(n.kind || "") + '">' +
              '<rect x="' + x + '" y="' + y + '" rx="8" ry="8" width="' + n.w + '" height="' + n.h + '" fill="transparent"></rect>' +
              '</g>' +
              '</g>';
          }).join("");
          svg.innerHTML = markerDefs + '<g>' + edgeSvg + "</g>" + '<g>' + edgeLabelSvg.join("") + "</g>" + '<g>' + nodeSvg + "</g>";
          if(hoverCard){
            svg.querySelectorAll(".graphNodeHotspot").forEach((el)=>{
              el.addEventListener("mousemove",(event)=>{
                const summary = el.getAttribute("data-summary") || "No overview available.";
                const nodeName = el.getAttribute("data-node") || "Node";
                hoverCard.innerHTML = "<strong>" + nodeName + "</strong><br>" + summary;
                hoverCard.style.display = "block";
                hoverCard.style.left = (event.offsetX + 14) + "px";
                hoverCard.style.top = (event.offsetY + 14) + "px";
              });
              el.addEventListener("mouseenter",()=>{
                graphSimState.hoveredNodeId = el.getAttribute("data-node-id") || null;
                graphSimState.lastInteractionTs = Date.now();
                if(graphSimulation){ graphSimulation.alphaTarget(0.14).restart(); }
              });
              el.addEventListener("mouseleave",()=>{
                hoverCard.style.display = "none";
                graphSimState.hoveredNodeId = null;
                if(graphSimulation){ graphSimulation.alphaTarget(0); }
              });
              el.addEventListener("click",()=>{
                const nodeId = el.getAttribute("data-node-id") || "";
                const nodeKind = el.getAttribute("data-kind") || "";
                const nodeName = el.getAttribute("data-node") || "File";
                if(graphViewMode === "technical" && nodeKind === "File" && nodeId){
                  void loadFunctionsForFile(nodeId, nodeName);
                }
              });
              el.addEventListener("mousedown",(evt)=>{
                const nodeId = el.getAttribute("data-node-id");
                if(!nodeId){ return; }
                const node = byId.get(nodeId);
                if(!node){ return; }
                graphDragState.active = true;
                graphDragState.nodeId = nodeId;
                graphDragState.pinOnRelease = Boolean(evt.shiftKey || evt.metaKey || evt.altKey || evt.ctrlKey);
                node.fx = node.x;
                node.fy = node.y;
                graphSimState.lastInteractionTs = Date.now();
                if(graphSimulation){ graphSimulation.alphaTarget(0.22).restart(); }
                evt.preventDefault();
              });
            });
          }
          const kinds = Array.from(new Set(simNodes.map((n)=>n.kind || "Other")));
          let legendHtml = kinds.sort().map((kind)=>'<span class="graphLegendItem"><span class="graphLegendSwatch" style="background:' + nodeColor(kind) + '"></span>' + escHtml(kind) + "</span>").join("");
          if((window.__graphSelectedFnId || "")){
            legendHtml += '<span class="graphLegendItem"><span class="graphLegendSwatch" style="background:' + edgeColor("calls") + '"></span>Invokes / Invoked By</span>' +
              '<span class="graphLegendItem"><span class="graphLegendSwatch" style="background:' + edgeColor("consumes") + '"></span>Consumes Output Of / Provides Output To</span>';
          }
          legend.innerHTML = legendHtml;
        }

        graphSimulation = d3.forceSimulation(simNodes)
          .force("charge", d3.forceManyBody().strength(-420))
          .force("link", d3.forceLink(simEdges).id((d)=>d.id).distance((e)=>{
            if(e.kind === "contains") return 180;
            if(e.kind === "calls") return 145;
            if(e.kind === "consumes") return 165;
            return 160;
          }).strength((e)=>{
            if(e.kind === "contains") return 0.26;
            return 0.2;
          }))
          .force("center", d3.forceCenter(width / 2, height / 2))
          .force("collide", d3.forceCollide().radius((d)=>Math.max(d.w, d.h) * 0.55 + 12).iterations(2))
          .force("hover-cluster", setupHoverForce({ nodes: simNodes, edges: simEdges }))
          .alpha(1)
          .alphaDecay(0.035)
          .velocityDecay(0.32)
          .on("tick", renderTick);

        function moveDrag(evt){
          if(!graphDragState.active || !graphDragState.nodeId){ return; }
          const node = byId.get(graphDragState.nodeId);
          if(!node){ return; }
          const rect = svg.getBoundingClientRect();
          const x = ((evt.clientX - rect.left) / rect.width) * width;
          const y = ((evt.clientY - rect.top) / rect.height) * height;
          node.fx = x;
          node.fy = y;
          graphSimState.lastInteractionTs = Date.now();
          if(graphSimulation){ graphSimulation.alphaTarget(0.24).restart(); }
        }
        function endDrag(){
          if(!graphDragState.active || !graphDragState.nodeId){ return; }
          const node = byId.get(graphDragState.nodeId);
          if(node && !graphDragState.pinOnRelease){
            node.fx = null;
            node.fy = null;
          }
          graphDragState.active = false;
          graphDragState.nodeId = null;
          graphDragState.pinOnRelease = false;
          if(graphSimulation){ graphSimulation.alphaTarget(0); }
        }
        svg.onmousemove = moveDrag;
        svg.onmouseup = endDrag;
        svg.onmouseleave = ()=>{ if(graphDragState.active){ endDrag(); } };

        renderTick();
        setTimeout(()=>{
          if(graphSimulation && !graphDragState.active && Date.now() - (graphSimState.lastInteractionTs || 0) > 2500){
            graphSimulation.stop();
          }
        }, 3200);
      }
      async function refreshGraphErd(){
        const hint = document.getElementById("graphHint");
        const svg = document.getElementById("graphCanvas");
        if(svg){ svg.classList.add("isRefreshing"); }
        try{
          if(graphViewMode === "business" || graphViewMode === "business-goal"){
            const layer = graphViewMode === "business-goal" ? "goal" : "full";
            const businessRes = await fetch(withToken("/api/graph/business-logic?layer=" + encodeURIComponent(layer))).then((r)=>r.json());
            if(!businessRes.ok){
              if(hint){ hint.textContent = "Business logic graph unavailable: " + (businessRes.error || "unknown"); }
              renderGraphErd([], []);
              return;
            }
            const graph = businessRes.graph || {};
            const nodes = graph.nodes || [];
            const edges = graph.edges || [];
            renderGraphErd(nodes, edges);
            if(hint){
              hint.textContent = (graphViewMode === "business-goal" ? "Business goal layer" : "Business flow") +
                " rendered with " + nodes.length + " node(s) and " + edges.length + " edge(s).";
            }
          } else {
            stopGraphSimulation();
            const nodesRes = await fetch(withToken("/api/graph/nodes?limit=2000")).then((r)=>r.json());
            const edgesRes = await fetch(withToken("/api/graph/edges?limit=4000")).then((r)=>r.json());
            if(!nodesRes.ok || !edgesRes.ok){
              if(hint){ hint.textContent = "Graph visualization unavailable: " + ((nodesRes.error || edgesRes.error || "unknown")); }
              renderGraphErd([], []);
              return;
            }
            const sourceNodes = nodesRes.nodes || [];
            const sourceEdges = edgesRes.edges || [];
            graphNodeCache = { nodes: sourceNodes, edges: sourceEdges };
            renderGraphErd(sourceNodes, sourceEdges);
            if(hint){
              hint.textContent = "Technical full graph rendered with " + sourceNodes.length + " node(s) and " + sourceEdges.length + " edge(s).";
            }
            if(graphFocusState.fileNodeId && graphFocusState.functionNodeId){
              await renderTechnicalFocusGraph();
            }
          }
        } catch(err){
          if(hint){ hint.textContent = "Graph visualization failed: " + ((err && err.message) ? err.message : String(err)); }
          renderGraphErd([], []);
        } finally {
          if(svg){ svg.classList.remove("isRefreshing"); }
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
      document.getElementById("pane2TabGraph")?.addEventListener("click",()=>{ openGraphOverlay(); });
      document.getElementById("btnDocsReindex")?.addEventListener("click",()=>{ void refreshDocsIndex(true); });
      document.getElementById("btnGraphRebuild")?.addEventListener("click",()=>{ void triggerGraphRebuild(); });
      document.getElementById("btnGraphReconcile")?.addEventListener("click",()=>{ void triggerGraphReconcile(); });
      document.getElementById("btnGraphApplyCorrection")?.addEventListener("click",()=>{ void applyGraphCorrectionPrompt(); });
      document.getElementById("btnGraphViewTechnical")?.addEventListener("click",()=>{
        graphViewMode = "technical";
        resetGraphExplorerState();
        const hint = document.getElementById("graphHint");
        if(hint){ hint.textContent = "Switched to technical graph view."; }
        void refreshGraphErd();
      });
      document.getElementById("btnGraphViewBusiness")?.addEventListener("click",()=>{
        graphViewMode = "business";
        resetGraphExplorerState();
        const hint = document.getElementById("graphHint");
        if(hint){ hint.textContent = "Switched to business logic graph view."; }
        void refreshGraphErd();
      });
      document.getElementById("btnGraphViewBusinessGoal")?.addEventListener("click",()=>{
        graphViewMode = "business-goal";
        resetGraphExplorerState();
        const hint = document.getElementById("graphHint");
        if(hint){ hint.textContent = "Switched to business goal layer."; }
        void refreshGraphErd();
      });
      document.getElementById("btnGraphLocalDeps")?.addEventListener("click",()=>{
        if(!graphFocusState.functionNodeId){ return; }
        graphFocusState.localDeps = !graphFocusState.localDeps;
        const btn = document.getElementById("btnGraphLocalDeps");
        if(btn){ btn.textContent = graphFocusState.localDeps ? "Hide local dependencies" : "Show local dependencies"; }
        rebuildFocusedGraphAndRender();
      });
      document.getElementById("btnGraphExternalDeps")?.addEventListener("click",()=>{
        if(!graphFocusState.functionNodeId){ return; }
        if(!graphFocusState.externalSeedIds.includes(graphFocusState.functionNodeId)){
          graphFocusState.externalSeedIds.push(graphFocusState.functionNodeId);
        }
        graphFocusState.localDeps = true;
        const depsBtn = document.getElementById("btnGraphLocalDeps");
        if(depsBtn){ depsBtn.textContent = "Hide local dependencies"; }
        const hint = document.getElementById("graphExplorerHint");
        if(hint){
          hint.textContent = "Expanded one-degree external dependencies for selected function. Select another function and expand again to cascade.";
        }
        rebuildFocusedGraphAndRender();
      });
      document.getElementById("btnGraphFocusReset")?.addEventListener("click",()=>{
        window.__graphSelectedFnId = "";
        graphFocusState.functionNodeId = null;
        graphFocusState.localDeps = false;
        graphFocusState.externalSeedIds = [];
        const btn = document.getElementById("btnGraphLocalDeps");
        if(btn){
          btn.textContent = "Show local dependencies";
          btn.disabled = true;
        }
        const extBtn = document.getElementById("btnGraphExternalDeps");
        if(extBtn){ extBtn.disabled = true; }
        const resetBtn = document.getElementById("btnGraphFocusReset");
        if(resetBtn){ resetBtn.disabled = true; }
        const list = document.getElementById("graphFunctionList");
        if(list){ list.querySelectorAll(".graphFnBtn").forEach((b)=>b.classList.remove("active")); }
        const explorerHint = document.getElementById("graphExplorerHint");
        if(explorerHint){ explorerHint.textContent = "Focus reset. Select a function from the list."; }
        void refreshGraphErd();
      });
      document.getElementById("btnGraphExit")?.addEventListener("click",()=>{
        resetGraphExplorerState();
        void refreshGraphErd();
      });
      document.getElementById("btnGraphBack")?.addEventListener("click",()=>{
        if (graphFocusState.functionNodeId) {
          document.getElementById("btnGraphFocusReset")?.click();
        } else {
          document.getElementById("btnGraphExit")?.click();
        }
      });
      document.getElementById("btnGraphFitView")?.addEventListener("click",()=>{
        graphViewBox.x = 0;
        graphViewBox.y = 0;
        graphViewBox.w = graphViewBox.baseW;
        graphViewBox.h = graphViewBox.baseH;
        applyGraphViewBox();
      });
      document.getElementById("btnGraphOverlayClose")?.addEventListener("click",()=>{ closeGraphOverlay(); });
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
      document.addEventListener("keydown",(event)=>{
        if(event.key === "Escape" && graphOverlayOpen){
          closeGraphOverlay();
        }
      });
      initGraphCanvasInteractions();
      panes.forEach((paneId)=>openPane(paneId));
      setPane2Tab("workspace");
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
