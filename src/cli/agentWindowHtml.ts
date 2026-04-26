/**
 * Standalone Agent window page — layout inspired by the Cursor/VS Code workbench
 * (title bar, activity rail, session sidebar, editor stack, bottom composer).
 */

export function buildAgentWindowPageHtml(authToken: string | undefined): string {
  const tokenJson = JSON.stringify(authToken ?? "");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Agent — Winnow</title>
    <style>
      :root {
        --bg: #000000;
        --panel2: #0a0a0a;
        --line: rgba(34, 211, 238, 0.32);
        --line-faint: rgba(34, 211, 238, 0.12);
        --text: #7dd3fc;
        --text-strong: #22d3ee;
        --text-neon: #5eead4;
        --muted: rgba(125, 211, 252, 0.58);
        --red-pastel: #fecaca;
        --red-neon: #f87171;
        --vscode-editor-background: var(--bg);
        --vscode-sideBar-background: var(--panel2);
        --vscode-activityBar-background: #000000;
        --vscode-titleBar-activeBackground: var(--panel2);
        --vscode-panel-border: var(--line);
        --vscode-input-background: var(--panel2);
        --vscode-button-background: #0e7490;
        --vscode-foreground: var(--text);
        --vscode-descriptionForeground: var(--muted);
        --accent: #22d3ee;
        --accent-soft: #5eead4;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        height: 100%;
        background: var(--bg);
        color: var(--text);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 13px;
        -webkit-font-smoothing: antialiased;
      }
      strong, b { color: var(--text-strong); font-weight: 700; }
      code { font-family: ui-monospace, Menlo, monospace; color: var(--text-neon); font-weight: 600; font-size: 0.95em; }
      body.embed .hide-embed { display: none !important; }
      body.embed .split { flex: 1; }
      .workbench { display: flex; flex-direction: column; height: 100vh; min-height: 0; }
      .title-bar {
        height: 30px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 10px;
        background: var(--vscode-titleBar-activeBackground);
        border-bottom: 1px solid var(--line);
        font-size: 12px;
        user-select: none;
      }
      .title-brand { display: flex; align-items: center; gap: 8px; color: var(--text-neon); font-weight: 700; }
      .title-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent-soft); }
      .title-bar nav a {
        color: var(--muted);
        text-decoration: none;
        margin-left: 12px;
        font-size: 11px;
        font-style: italic;
      }
      .title-bar nav a:hover { color: var(--text-neon); }
      .body { flex: 1; min-height: 0; display: flex; min-width: 0; }
      .activity-bar {
        width: 48px;
        flex-shrink: 0;
        background: var(--vscode-activityBar-background);
        border-right: 1px solid var(--vscode-panel-border);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding-top: 10px;
        gap: 10px;
      }
      .activity-icon {
        width: 36px;
        height: 36px;
        border-radius: 4px;
        background: var(--panel2);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text);
        font-size: 10px;
        font-weight: 700;
        border: 1px solid var(--line);
        border-left: 3px solid var(--accent-soft);
      }
      .split { flex: 1; min-width: 0; display: flex; min-height: 0; }
      .side-bar {
        width: 280px;
        flex-shrink: 0;
        background: var(--vscode-sideBar-background);
        border-right: 1px solid var(--vscode-panel-border);
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .side-header {
        padding: 10px 12px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--muted);
        font-style: italic;
        font-weight: 600;
        border-bottom: 1px solid var(--vscode-panel-border);
      }
      .main-panel {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        min-height: 0;
        background: var(--vscode-editor-background);
      }
      .panel-toolbar {
        flex-shrink: 0;
        padding: 10px 12px;
        border-bottom: 1px solid var(--vscode-panel-border);
      }
      input, select, button, textarea {
        background: var(--vscode-input-background);
        border: 1px solid var(--line);
        color: var(--text);
        border-radius: 4px;
        padding: 5px 8px;
        font-family: inherit;
        font-size: 12px;
      }
      input:focus, select:focus, textarea:focus {
        outline: none;
        border-color: var(--accent);
        box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.22);
      }
      button {
        cursor: pointer;
        background: var(--vscode-button-background);
        border-color: var(--accent);
        color: #000;
        font-weight: 600;
      }
      button:hover { filter: brightness(1.12); }
      button.secondary { background: transparent; border-color: var(--line); color: var(--text); }
      .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .muted { color: var(--muted); }
      .small { font-size: 11px; }
      .hint { font-size: 11px; color: var(--muted); margin-top: 6px; font-style: italic; }
      .quickbar { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .quickbar button { background: var(--line-faint); border-color: var(--line); color: var(--text-neon); font-size: 11px; }
      .kbd {
        border: 1px solid var(--line);
        padding: 1px 6px;
        border-radius: 4px;
        font-size: 10px;
        color: var(--muted);
        background: var(--bg);
        font-style: italic;
      }
      .statusBadge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        background: var(--panel2);
        border: 1px solid var(--line);
        color: var(--text-neon);
        font-weight: 700;
      }
      .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-top: 8px; }
      .metric { border: 1px solid var(--line); border-radius: 4px; padding: 6px; background: var(--bg); }
      .metricLabel { font-size: 10px; color: var(--muted); font-style: italic; }
      .metricValue { font-size: 12px; font-weight: 600; color: var(--text); }
      #metricPromptTokens, #metricChunks, #metricElapsed { color: var(--text-strong); }
      #metricOutputTokens { color: var(--red-pastel); }
      .chat-scroll { flex: 1; min-height: 0; overflow: auto; padding: 12px 12px 8px; }
      #chatHistory { min-height: 80px; }
      .chatMsg {
        margin-bottom: 10px;
        border-radius: 6px;
        padding: 10px 12px;
        border: 1px solid var(--line);
        max-width: 920px;
        background: var(--bg);
      }
      .chatRole { font-size: 10px; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; font-weight: 700; font-style: italic; }
      .chatText {
        white-space: pre-wrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        line-height: 1.45;
        color: var(--text);
      }
      @keyframes winnow-spin {
        to {
          transform: rotate(360deg);
        }
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
        justify-content: center;
        gap: 12px;
        margin-top: 0;
        padding: 10px 12px;
        min-height: 88px;
        border: 1px solid var(--line);
        border-radius: 6px;
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
      #agentThinking {
        flex-shrink: 0;
        max-height: 100px;
        overflow: auto;
        font-size: 11px;
        margin: 0 12px;
        padding: 8px;
        background: var(--panel2);
        border: 1px solid var(--line);
        border-radius: 4px;
        font-family: ui-monospace, Menlo, monospace;
        white-space: pre-wrap;
        color: var(--muted);
        font-style: italic;
      }
      .composer {
        flex-shrink: 0;
        border-top: 1px solid var(--vscode-panel-border);
        padding: 10px 12px 12px;
        background: var(--bg);
      }
      #agentPrompt { width: 100%; min-height: 88px; resize: vertical; border-radius: 6px; font-family: ui-monospace, Menlo, monospace; }
      .composer-actions {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 8px;
        flex-wrap: wrap;
      }
      .composer-actions > .small.muted:first-child {
        margin-right: auto;
      }
      #sessionList {
        border: 1px solid var(--line);
        border-radius: 4px;
        overflow: auto;
        max-height: 200px;
        margin: 0 8px;
        background: var(--bg);
      }
      #sessionDirInfo { padding: 6px 10px; font-size: 10px; }
      #sessionPreview {
        font-size: 10px;
        white-space: pre-wrap;
        max-height: 120px;
        overflow: auto;
        margin: 8px;
        padding: 8px;
        background: var(--panel2);
        border: 1px solid var(--line);
        border-radius: 4px;
        font-family: ui-monospace, Menlo, monospace;
        color: var(--text);
      }
      #result { font-size: 10px; margin: 0 10px 8px; color: var(--muted); min-height: 14px; font-style: italic; }
      .entry {
        display: block;
        width: 100%;
        text-align: left;
        border: 0;
        background: transparent;
        color: inherit;
        padding: 5px 8px;
        cursor: pointer;
        font-size: 11px;
        font-family: inherit;
      }
      .entry:hover { background: var(--line-faint); color: var(--text-neon); }
      .session-actions { padding: 0 8px 8px; display: flex; gap: 6px; flex-wrap: wrap; }
    </style>
  </head>
  <body>
    <div class="workbench">
      <header class="title-bar hide-embed">
        <div class="title-brand">
          <span class="title-dot" aria-hidden="true"></span>
          <span>Winnow — Agent</span>
          <span class="small muted">(Cursor CLI)</span>
        </div>
        <nav>
          <a href="#" id="linkDashboard">Dashboard</a>
          <a href="#" id="linkMainGrid">Main grid</a>
        </nav>
      </header>
      <div class="body">
        <aside class="activity-bar hide-embed" aria-label="Activity bar">
          <div class="activity-icon" title="Agent">Ag</div>
        </aside>
        <div class="split">
          <aside class="side-bar hide-embed">
            <div class="side-header">Sessions</div>
            <div class="row small" style="padding: 8px 10px">
              <button type="button" class="secondary" onclick="refreshSessions()">Refresh</button>
            </div>
            <div class="small muted" id="sessionDirInfo"></div>
            <div id="sessionList"></div>
            <div class="session-actions">
              <button type="button" class="secondary" onclick="continueSelectedSession()">Continue selected</button>
              <button type="button" class="secondary" onclick="useSelectedPrompt()">Use last prompt</button>
            </div>
            <pre id="sessionPreview">No session selected.</pre>
            <div id="result"></div>
          </aside>
          <main class="main-panel">
            <div class="panel-toolbar">
              <div class="row small">
                <label>Model</label>
                <select id="agentModelPref">
                  <option value="default">default</option>
                  <option value="auto">auto</option>
                  <option value="composer">composer</option>
                </select>
                <label><input id="autonomyMode" type="checkbox" checked /> autonomous</label>
                <label><input id="continueMode" type="checkbox" /> continue session</label>
              </div>
              <div class="row small" style="margin-top: 8px">
                <label>Cursor args</label>
                <input id="agentArgs" style="flex:1; min-width: 200px" placeholder="optional args for cursor-agent" />
                <span class="agent-run-wrap">
                  <button type="button" data-agent-run="1" onclick="startAgentRun()">Run</button>
                  <span class="agent-run-overlay-spinner" aria-hidden="true"></span>
                </span>
                <span class="kbd">⌘↵</span>
              </div>
              <div class="row small" style="margin-top: 8px">
                <label>Resume</label>
                <select id="agentSessionSelect" style="min-width: 220px; flex: 1">
                  <option value="">(new session)</option>
                </select>
                <button type="button" class="secondary" onclick="refreshSessions()">Reload</button>
                <button type="button" class="secondary" onclick="startFreshSession()">New chat</button>
              </div>
              <div class="row small" style="margin-top: 8px; align-items: stretch">
                <label style="align-self: center">Cwd</label>
                <input id="agentCwdInput" style="flex: 1; min-width: 160px" placeholder="Path or ~/… (same as terminal cd)" />
                <button type="button" onclick="applyAgentCwd()">Set cwd</button>
                <button type="button" class="secondary" onclick="resetAgentCwd()">Reset</button>
              </div>
              <div class="small muted" id="agentCwdHint"></div>
              <div class="quickbar">
                <button type="button" onclick="appendPrompt('Implement the requested change with tests, then summarize what changed.')">Implement + tests</button>
                <button type="button" onclick="appendPrompt('Review this code for bugs and edge cases, then propose a minimal patch.')">Review</button>
                <button type="button" onclick="appendPrompt('Refactor this code for readability without changing behavior.')">Refactor</button>
                <button type="button" class="secondary" onclick="clearPrompt()">Clear</button>
              </div>
              <div class="small" style="margin-top: 8px">
                <span class="statusBadge" id="agentStatusBadge">idle</span>
                <span id="agentSessionInfo">No active session.</span>
              </div>
              <div class="hint">Tip: pass <code>--resume &lt;sessionId&gt;</code> in Cursor args to continue a session.</div>
              <div class="metrics">
                <div class="metric"><div class="metricLabel">Prompt tok (est)</div><div class="metricValue" id="metricPromptTokens">0</div></div>
                <div class="metric"><div class="metricLabel">Output tok (est)</div><div class="metricValue" id="metricOutputTokens">0</div></div>
                <div class="metric"><div class="metricLabel">Chunks</div><div class="metricValue" id="metricChunks">0</div></div>
                <div class="metric"><div class="metricLabel">Elapsed</div><div class="metricValue" id="metricElapsed">0s</div></div>
              </div>
            </div>
            <div class="small muted" style="padding: 6px 12px 0">Thinking trace</div>
            <pre id="agentThinking">No thinking trace yet.</pre>
            <div class="small muted" style="padding: 6px 12px 0">Conversation</div>
            <div class="chat-scroll"><div id="chatHistory"></div></div>
            <div class="composer">
              <textarea id="agentPrompt" placeholder="Describe the task for Cursor agent…"></textarea>
              <div id="agentRunLoadingBanner" class="agent-run-loading" role="status" aria-live="polite" aria-hidden="true">
                <div class="agent-run-loading-top">
                  <span class="agent-run-spinner-lg" aria-hidden="true"></span>
                  <p id="agentRunFlavorText" class="agent-run-flavor">Working…</p>
                </div>
                <button type="button" id="btnAgentRunCancel" class="secondary" onclick="cancelAgentRun()">Cancel</button>
              </div>
              <div class="composer-actions">
                <span class="small muted">cwd: <span id="agentCwdLabel">…</span></span>
                <span class="agent-run-wrap">
                  <button type="button" data-agent-run="1" onclick="startAgentRun()">Run</button>
                  <span class="agent-run-overlay-spinner" aria-hidden="true"></span>
                </span>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
    <script>
      const AUTH_TOKEN = ${tokenJson};
      const PAGE_PARAMS = new URLSearchParams(window.location.search);
      const EMBED_MODE = PAGE_PARAMS.get("embed") === "1";
      function withToken(path) {
        if (!AUTH_TOKEN) {
          return path;
        }
        const glue = path.includes("?") ? "&" : "?";
        return path + glue + "token=" + encodeURIComponent(AUTH_TOKEN);
      }
      function formatLocalDateTime(value) {
        const dt = new Date(value || "");
        if (!Number.isFinite(dt.getTime())) {
          return String(value || "");
        }
        return dt.toLocaleString([], {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });
      }
      function openDashboard() {
        window.location.assign(withToken("/"));
      }
      function openMainGrid() {
        window.location.assign(withToken("/main"));
      }
      async function refreshAgentCwdBanner() {
        const label = document.getElementById("agentCwdLabel");
        const input = document.getElementById("agentCwdInput");
        const hint = document.getElementById("agentCwdHint");
        try {
          const d = await fetch(withToken("/api/workspace/cwd")).then((r) => r.json());
          if (label) {
            label.textContent = d.cwd || "…";
          }
          if (input) {
            input.value = d.cwd || "";
          }
          if (hint) {
            hint.textContent =
              "transcripts: " + (d.transcriptDir || "") + " · launched: " + (d.launchRoot || "");
          }
        } catch (_e) {}
      }
      async function applyAgentCwd() {
        const input = document.getElementById("agentCwdInput");
        const path = (input && input.value) || "";
        const trimmed = path.trim();
        if (!trimmed) {
          return;
        }
        const res = await fetch(withToken("/api/workspace/cwd"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: trimmed }),
        }).then((r) => r.json());
        const resultEl = document.getElementById("result");
        if (resultEl) {
          resultEl.textContent = JSON.stringify(res);
        }
        if (res.ok) {
          await refreshAgentCwdBanner();
          await refreshSessions();
        }
      }
      async function resetAgentCwd() {
        const res = await fetch(withToken("/api/workspace/cwd"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reset: true }),
        }).then((r) => r.json());
        const resultEl = document.getElementById("result");
        if (resultEl) {
          resultEl.textContent = JSON.stringify(res);
        }
        if (res.ok) {
          await refreshAgentCwdBanner();
          await refreshSessions();
        }
      }
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
      let agentMetrics = { startedAtMs: 0, promptChars: 0, outputChars: 0, chunkCount: 0 };
      let thinkingEvents = [];
      let lastTraceAtMs = 0;
      const seenTimelineIds = new Set();
      function estimateTokens(chars) {
        return Math.max(0, Math.ceil(chars / 4));
      }
      function formatElapsed(ms) {
        if (ms <= 0) {
          return "0s";
        }
        const sec = Math.floor(ms / 1000);
        if (sec < 60) {
          return sec + "s";
        }
        const min = Math.floor(sec / 60);
        const rem = sec % 60;
        return min + "m " + rem + "s";
      }
      function refreshMetrics() {
        document.getElementById("metricPromptTokens").textContent = String(estimateTokens(agentMetrics.promptChars));
        document.getElementById("metricOutputTokens").textContent = String(estimateTokens(agentMetrics.outputChars));
        document.getElementById("metricChunks").textContent = String(agentMetrics.chunkCount);
        const elapsed = agentMetrics.startedAtMs ? Date.now() - agentMetrics.startedAtMs : 0;
        document.getElementById("metricElapsed").textContent = formatElapsed(elapsed);
      }
      function scrollToBottom() {
        const root = document.getElementById("chatHistory");
        if (root && root.parentElement) {
          root.parentElement.scrollTop = root.parentElement.scrollHeight;
        }
      }
      function appendChat(role, text) {
        const root = document.getElementById("chatHistory");
        if (!root) {
          return;
        }
        
        const lastMsg = root.lastElementChild;
        if (lastMsg) {
          const roleEl = lastMsg.querySelector(".chatRole");
          if (roleEl && roleEl.textContent === role) {
            const textEl = lastMsg.querySelector(".chatText");
            if (textEl) {
              textEl.textContent += text;
              scrollToBottom();
              return;
            }
          }
        }

        const msg = document.createElement("div");
        msg.className = "chatMsg";
        const roleEl = document.createElement("div");
        roleEl.className = "chatRole";
        roleEl.textContent = role;
        const textEl = document.createElement("div");
        textEl.className = "chatText";
        textEl.textContent = text;
        msg.appendChild(roleEl);
        msg.appendChild(textEl);
        root.appendChild(msg);
        scrollToBottom();
      }
      function clearChat() {
        const root = document.getElementById("chatHistory");
        if (root) {
          root.innerHTML = "";
        }
        seenTimelineIds.clear();
      }
      function appendFromTimelineEvent(ev) {
        if (!ev || !ev.id) {
          return;
        }
        if (seenTimelineIds.has(ev.id)) {
          return;
        }
        seenTimelineIds.add(ev.id);
        const kind = String(ev.kind || "system");
        
        if (kind === "tool" || kind === "status" || kind === "system") {
          pushTrace(ev.content || "");
          return;
        }

        let lane = "system";
        if (kind === "user") {
          lane = "user";
        } else if (kind === "assistant") {
          lane = "assistant";
        } else if (kind === "stderr") {
          lane = "stderr";
        }

        appendChat(lane, ev.content || "");
        if (kind === "assistant" || kind === "stderr") {
          agentMetrics.outputChars += (ev.content || "").length;
          agentMetrics.chunkCount += 1;
        }
        refreshMetrics();
      }
      function loadHistoryIntoPanels(messages) {
        clearChat();
        thinkingEvents = [];
        lastTraceAtMs = Date.now();
        for (const msg of messages || []) {
          if (msg.id) {
            seenTimelineIds.add(msg.id);
          }
          const role = String(msg.role || "entry").toLowerCase();

          if (role === "tool" || role === "status" || role === "system") {
            pushTrace(msg.content || "");
            continue;
          }

          let lane = "assistant";
          if (role === "user" || role.includes("user") || role.includes("human")) {
            lane = "user";
          } else if (role === "stderr" || role.includes("stderr") || role.includes("error")) {
            lane = "stderr";
          } else if (role === "status" || role.includes("system") || role.includes("event")) {
            lane = "system";
          }
          appendChat(lane, msg.content || "");
        }
        const thinkingBlock = document.getElementById("agentThinking");
        if (thinkingEvents.length === 0) {
          thinkingBlock.textContent = "No thinking trace found in this session history.";
        }
        scrollToBottom();
      }
      function updateResumeSelect(rows) {
        cachedSessionRows = Array.isArray(rows) ? rows : [];
        const select = document.getElementById("agentSessionSelect");
        if (!select) {
          return;
        }
        const prev = selectedResumeSessionId || select.value || "";
        const options = ['<option value="">(new session)</option>'].concat(
          cachedSessionRows.map((s) => {
            const label = "[" + formatLocalDateTime(s.updatedAt || "") + "] " + String(s.id || "").slice(0, 8) + "  " + (s.preview || "");
            return '<option value="' + s.id + '">' + label.replace(/"/g, "&quot;") + "</option>";
          }),
        );
        select.innerHTML = options.join("");
        const nextValue = cachedSessionRows.some((s) => s.id === prev) ? prev : "";
        select.value = nextValue;
        selectedResumeSessionId = nextValue || null;
      }
      function updateArgsResume(id) {
        void id;
      }
      function startFreshSession() {
        selectedResumeSessionId = null;
        const select = document.getElementById("agentSessionSelect");
        if (select) {
          select.value = "";
        }
        updateArgsResume(null);
        appendChat("system", "Switched to new session mode.");
      }
      function traceNow() {
        return new Date().toTimeString().slice(0, 8);
      }
      function pushTrace(line) {
        if (!line) {
          return;
        }
        thinkingEvents.push("[" + traceNow() + "] " + line);
        if (thinkingEvents.length > 120) {
          thinkingEvents = thinkingEvents.slice(-120);
        }
        const block = document.getElementById("agentThinking");
        block.textContent = thinkingEvents.join("\\n");
        block.scrollTop = block.scrollHeight;
        lastTraceAtMs = Date.now();
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
      async function pollAgent() {
        if (!activeSessionId) {
          return;
        }
        const res = await fetch(withToken("/api/agent/" + activeSessionId)).then((r) => r.json());
        if (!res.ok) {
          return;
        }
        const s = res.session;
        document.getElementById("agentSessionInfo").textContent =
          "session=" + s.id + " status=" + s.status + (s.exitCode !== undefined ? " exit=" + s.exitCode : "");
        document.getElementById("agentStatusBadge").textContent = s.status;
        agentMetrics.outputChars = (s.output || "").length + (s.errorOutput || "").length;
        refreshMetrics();
        const streamDead = !streamSource || streamSource.readyState !== 1;
        if (streamDead && Array.isArray(s.events)) {
          for (const ev of s.events) {
            appendFromTimelineEvent(ev);
          }
        }
        if (s.status !== "running" && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
          playSound(s.status === 'done' ? 'success' : 'error');
        }
        if (s.status !== "running") {
          agentSessionRunning = false;
          applyAgentRunUi();
        } else {
          agentSessionRunning = true;
          applyAgentRunUi();
        }
      }
      function closeStream() {
        if (streamSource) {
          streamSource.close();
          streamSource = null;
        }
      }
      function attachStream(sessionId) {
        closeStream();
        streamSource = new EventSource(withToken("/api/agent/" + sessionId + "/stream"));
        streamSource.addEventListener("timeline", (evt) => {
          try {
            const data = JSON.parse(evt.data || "{}");
            if (data.event) {
              appendFromTimelineEvent(data.event);
            }
          } catch (_e) {}
        });
        streamSource.addEventListener("status", (evt) => {
          const data = JSON.parse(evt.data || "{}");
          document.getElementById("agentSessionInfo").textContent =
            "session=" +
            sessionId +
            " status=" +
            (data.status || "running") +
            (data.exitCode !== undefined ? " exit=" + data.exitCode : "");
          document.getElementById("agentStatusBadge").textContent = data.status || "running";
          const st = data.status || "running";
          agentSessionRunning = st === "running";
          applyAgentRunUi();
          refreshMetrics();
        });
        streamSource.addEventListener("done", () => {
          pushTrace("stream completed");
          closeStream();
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          pollAgent();
        });
        streamSource.onerror = () => {
          closeStream();
          if (!pollTimer) {
            pollTimer = setInterval(pollAgent, 1000);
          }
        };
      }
      function clearAgentFlavorTimer() {
        if (agentFlavorTimer) {
          clearInterval(agentFlavorTimer);
          agentFlavorTimer = null;
        }
      }
      function tickAgentFlavor() {
        const el = document.getElementById("agentRunFlavorText");
        if (!el) {
          return;
        }
        agentFlavorIndex = (agentFlavorIndex + 1) % AGENT_RUN_FLAVOR.length;
        el.textContent = AGENT_RUN_FLAVOR[agentFlavorIndex];
      }
      function syncAgentLoadingHeight() {
        const ta = document.getElementById("agentPrompt");
        const banner = document.getElementById("agentRunLoadingBanner");
        if (!ta || !banner) {
          return;
        }
        const px = Math.max(88, Math.round(ta.getBoundingClientRect().height || 0));
        banner.style.minHeight = px + "px";
      }
      function applyAgentRunUi() {
        const locked = agentStartInFlight || agentSessionRunning;
        document.querySelectorAll("[data-agent-run]").forEach((b) => {
          b.disabled = locked;
          b.textContent = locked ? "Running" : "Run";
        });
        document.querySelectorAll(".agent-run-wrap").forEach((w) => {
          w.classList.toggle("is-busy", locked);
        });
        const ta = document.getElementById("agentPrompt");
        if (ta) {
          ta.disabled = locked;
          ta.style.display = locked ? "none" : "";
        }
        syncAgentLoadingHeight();
        const banner = document.getElementById("agentRunLoadingBanner");
        const cancelBtn = document.getElementById("btnAgentRunCancel");
        if (banner) {
          banner.classList.toggle("is-visible", locked);
          banner.setAttribute("aria-hidden", locked ? "false" : "true");
        }
        if (locked) {
          const flavorEl = document.getElementById("agentRunFlavorText");
          if (flavorEl) {
            flavorEl.textContent = AGENT_RUN_FLAVOR[agentFlavorIndex % AGENT_RUN_FLAVOR.length];
          }
          if (!agentFlavorTimer) {
            agentFlavorTimer = setInterval(tickAgentFlavor, 2800);
          }
        } else {
          clearAgentFlavorTimer();
          agentFlavorIndex = 0;
        }
        if (cancelBtn) {
          cancelBtn.disabled = false;
        }
      }
      async function cancelAgentRun() {
        if (agentStartInFlight && agentStartAbort) {
          agentStartAbort.abort();
          return;
        }
        if (!agentSessionRunning || !activeSessionId) {
          return;
        }
        const cancelBtn = document.getElementById("btnAgentRunCancel");
        if (cancelBtn) {
          cancelBtn.disabled = true;
        }
        try {
          const httpRes = await fetch(withToken("/api/agent/" + activeSessionId + "/stop"), {
            method: "POST",
          });
          const data = await httpRes.json();
          if (data && data.ok && data.stopped) {
            appendChat("system", "Stop requested — winding down the agent process.");
          } else if (data && data.ok) {
            appendChat("system", "Stop was ignored (session may already be idle).");
          } else {
            appendChat("system", "Stop failed: " + JSON.stringify(data));
          }
        } catch (err) {
          appendChat("system", "Stop failed: " + (err && err.message ? err.message : String(err)));
        } finally {
          if (cancelBtn) {
            cancelBtn.disabled = false;
          }
        }
      }
      async function startAgentRun() {
        const prompt = document.getElementById("agentPrompt").value.trim();
        if (!prompt) {
          appendChat("system", "Prompt is required.");
          return;
        }
        const busyGate = document.querySelector("[data-agent-run]");
        if (busyGate && busyGate.disabled) {
          return;
        }
        const continueMode = document.getElementById("continueMode").checked;
        const select = document.getElementById("agentSessionSelect");
        const pickedSession = (select?.value || selectedResumeSessionId || "").trim();
        const resumeSessionId = continueMode ? pickedSession || selectedResumeSessionId || activeSessionId || "" : "";
        const baseArgs = (document.getElementById("agentArgs").value || "").trim();
        const cleanedArgs = baseArgs.replace(/(?:^|\\s)--resume\\s+\\S+/g, "").trim();
        const effectiveArgs = resumeSessionId
          ? cleanedArgs
            ? cleanedArgs + " --resume " + resumeSessionId
            : "--resume " + resumeSessionId
          : cleanedArgs;
        const payload = {
          prompt,
          args: effectiveArgs,
          modelPreference: document.getElementById("agentModelPref").value,
          autonomyMode: document.getElementById("autonomyMode").checked,
          sessionId: resumeSessionId || undefined,
        };
        agentStartAbort = new AbortController();
        agentStartInFlight = true;
        applyAgentRunUi();
        let res = null;
        try {
          const httpRes = await fetch(withToken("/api/agent/start"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: agentStartAbort.signal,
          });
          res = await httpRes.json();
          if (res && res.ok === true) {
            agentSessionRunning = true;
          }
        } catch (err) {
          const name = err && err.name ? err.name : "";
          if (name === "AbortError") {
            appendChat("system", "Start cancelled.");
            return;
          }
          appendChat("system", "Failed to start: " + (err && err.message ? err.message : String(err)));
          return;
        } finally {
          agentStartInFlight = false;
          agentStartAbort = null;
          applyAgentRunUi();
        }
        if (!res || !res.ok) {
          agentSessionRunning = false;
          applyAgentRunUi();
          appendChat("system", "Failed to start: " + JSON.stringify(res));
          return;
        }
        activeSessionId = res.sessionId;
        clearPrompt();
        if (continueMode) {
          selectedResumeSessionId = activeSessionId;
        }
        clearChat();
        thinkingEvents = [];
        lastTraceAtMs = Date.now();
        document.getElementById("agentThinking").textContent = "";
        pushTrace("session started");
        document.getElementById("agentStatusBadge").textContent = "running";
        document.getElementById("agentSessionInfo").textContent = "session=" + activeSessionId + " status=running";
        agentMetrics = { startedAtMs: Date.now(), promptChars: prompt.length, outputChars: 0, chunkCount: 0 };
        refreshMetrics();
        if (pollTimer) {
          clearInterval(pollTimer);
        }
        pollTimer = setInterval(pollAgent, 1000);
        attachStream(activeSessionId);
        pollAgent();
        setTimeout(refreshSessions, 500);
      }
      function appendPrompt(text) {
        const area = document.getElementById("agentPrompt");
        const current = area.value.trim();
        area.value = current ? current + "\\n\\n" + text : text;
        area.focus();
      }
      function clearPrompt() {
        const area = document.getElementById("agentPrompt");
        area.value = "";
        if (!area.disabled) {
          area.focus();
        }
      }
      async function refreshSessions() {
        const data = await fetch(withToken("/api/sessions?limit=25")).then((r) => r.json());
        await refreshAgentCwdBanner();
        const dirEl = document.getElementById("sessionDirInfo");
        if (dirEl) {
          dirEl.textContent = "dir: " + (data.dir || "(unknown)");
        }
        updateResumeSelect(data.sessions || []);
        const rows = (data.sessions || [])
          .map(
            (s, idx) =>
              '<button type="button" class="entry sync-session" data-session-id="' +
              s.id +
              '"' +
              (idx === 0 ? ' style="border:1px solid var(--accent)"' : "") +
              ">" +
              "[" +
              formatLocalDateTime(s.updatedAt || "") +
              "] " +
              s.id.slice(0, 8) +
              "  " +
              (s.preview || "") +
              "</button>",
          )
          .join("");
        const listEl = document.getElementById("sessionList");
        if (listEl) {
          listEl.innerHTML = rows || '<span class="muted small" style="padding:8px;display:block">No sessions yet.</span>';
        }
        document.querySelectorAll(".sync-session").forEach((el) => {
          el.onclick = () => loadSession(el.getAttribute("data-session-id"));
        });
        if (selectedResumeSessionId) {
          await loadSession(selectedResumeSessionId);
        }
      }
      async function loadSession(id) {
        if (!id) {
          return;
        }
        selectedSyncedSession = id;
        selectedResumeSessionId = id;
        activeSessionId = id;
        updateArgsResume(id);
        const select = document.getElementById("agentSessionSelect");
        if (select) {
          select.value = id;
        }
        const data = await fetch(withToken("/api/sessions/" + id)).then((r) => r.json());
        selectedSyncedMessages = data.messages || [];
        loadHistoryIntoPanels(selectedSyncedMessages);
        const preview = selectedSyncedMessages
          .slice(-8)
          .map((m) => "[" + m.role + "] " + m.content)
          .join("\\n\\n");
        const prevEl = document.getElementById("sessionPreview");
        if (prevEl) {
          prevEl.textContent = preview || "No message content.";
        }
        document.querySelectorAll(".sync-session").forEach((el) => {
          el.style.border =
            el.getAttribute("data-session-id") === id ? "1px solid var(--accent)" : "1px solid transparent";
        });
      }
      function continueSelectedSession() {
        if (!selectedSyncedSession) {
          document.getElementById("result").textContent = "Select a synced session first.";
          return;
        }
        selectedResumeSessionId = selectedSyncedSession;
        const select = document.getElementById("agentSessionSelect");
        if (select) {
          select.value = selectedSyncedSession;
        }
        document.getElementById("result").textContent = "Resume target set to session: " + selectedSyncedSession;
      }
      function useSelectedPrompt() {
        if (!selectedSyncedMessages || selectedSyncedMessages.length === 0) {
          document.getElementById("result").textContent = "No messages in selected session.";
          return;
        }
        const lastUserLike = [...selectedSyncedMessages].reverse().find(
          (m) => String(m.role).toLowerCase().includes("user") || String(m.role).toLowerCase().includes("human"),
        );
        const pick = lastUserLike || selectedSyncedMessages[selectedSyncedMessages.length - 1];
        document.getElementById("agentPrompt").value = pick.content || "";
        document.getElementById("result").textContent = "Loaded prompt from synced session.";
      }
      document.getElementById("linkDashboard").addEventListener("click", (e) => {
        e.preventDefault();
        openDashboard();
      });
      document.getElementById("linkMainGrid").addEventListener("click", (e) => {
        e.preventDefault();
        openMainGrid();
      });
      const sessionSelect = document.getElementById("agentSessionSelect");
      if (sessionSelect) {
        sessionSelect.addEventListener("change", () => {
          const value = sessionSelect.value || "";
          selectedResumeSessionId = value || null;
          updateArgsResume(selectedResumeSessionId);
          if (value) {
            loadSession(value);
          }
        });
      }
      document.getElementById("agentPrompt").addEventListener("keydown", (evt) => {
        const withCmd = evt.metaKey || evt.ctrlKey;
        if (withCmd && evt.key === "Enter") {
          if (evt.target && evt.target.disabled) {
            return;
          }
          evt.preventDefault();
          startAgentRun();
        }
      });
      document.getElementById("agentPrompt").addEventListener("input", syncAgentLoadingHeight);
      window.addEventListener("resize", syncAgentLoadingHeight);
      refreshSessions();
      setInterval(refreshMetrics, 1000);
      if (EMBED_MODE) {
        document.body.classList.add("embed");
      }
      syncAgentLoadingHeight();
    </script>
  </body>
</html>`;
}
