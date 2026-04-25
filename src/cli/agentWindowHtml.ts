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
        --vscode-editor-background: #1e1e1e;
        --vscode-sideBar-background: #252526;
        --vscode-activityBar-background: #333333;
        --vscode-titleBar-activeBackground: #3c3c3c;
        --vscode-panel-border: #2b2b2b;
        --vscode-input-background: #3c3c3c;
        --vscode-button-background: #0e639c;
        --vscode-foreground: #cccccc;
        --vscode-descriptionForeground: #9d9d9d;
        --accent: #007fd4;
        --accent-soft: #6ec7ff;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        height: 100%;
        background: var(--vscode-editor-background);
        color: var(--vscode-foreground);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        font-size: 13px;
      }
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
        border-bottom: 1px solid #1b1b1b;
        font-size: 12px;
        user-select: none;
      }
      .title-brand { display: flex; align-items: center; gap: 8px; color: #ccc; }
      .title-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent-soft); }
      .title-bar nav a {
        color: var(--vscode-descriptionForeground);
        text-decoration: none;
        margin-left: 12px;
        font-size: 11px;
      }
      .title-bar nav a:hover { color: #fff; }
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
        background: #3c3c3c;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-size: 10px;
        font-weight: 700;
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
        color: var(--vscode-descriptionForeground);
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
        border: 1px solid #555;
        color: var(--vscode-foreground);
        border-radius: 4px;
        padding: 5px 8px;
        font-family: inherit;
        font-size: 12px;
      }
      button {
        cursor: pointer;
        background: var(--vscode-button-background);
        border-color: #1177bb;
        color: #fff;
      }
      button:hover { filter: brightness(1.08); }
      button.secondary { background: transparent; border-color: #555; color: var(--vscode-foreground); }
      .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .muted { color: var(--vscode-descriptionForeground); }
      .small { font-size: 11px; }
      .hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 6px; }
      .quickbar { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .quickbar button { background: #3c3c3c; border-color: #555; color: #e0e0e0; font-size: 11px; }
      .kbd {
        border: 1px solid #555;
        padding: 1px 6px;
        border-radius: 4px;
        font-size: 10px;
        color: #9d9d9d;
        background: #2d2d2d;
      }
      .statusBadge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        background: #333;
        border: 1px solid #555;
      }
      .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-top: 8px; }
      .metric { border: 1px solid #2b2b2b; border-radius: 4px; padding: 6px; background: #252526; }
      .metricLabel { font-size: 10px; color: #9d9d9d; }
      .metricValue { font-size: 12px; }
      .chat-scroll { flex: 1; min-height: 0; overflow: auto; padding: 12px 12px 8px; }
      #chatHistory { min-height: 80px; }
      .chatMsg {
        margin-bottom: 10px;
        border-radius: 6px;
        padding: 10px 12px;
        border: 1px solid #3c3c3c;
        max-width: 920px;
        background: #252526;
      }
      .chatRole { font-size: 10px; text-transform: uppercase; color: #9d9d9d; margin-bottom: 6px; }
      .chatText {
        white-space: pre-wrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        line-height: 1.45;
      }
      #agentThinking {
        flex-shrink: 0;
        max-height: 100px;
        overflow: auto;
        font-size: 11px;
        margin: 0 12px;
        padding: 8px;
        background: #252526;
        border: 1px solid #333;
        border-radius: 4px;
        font-family: ui-monospace, Menlo, monospace;
        white-space: pre-wrap;
      }
      .composer {
        flex-shrink: 0;
        border-top: 1px solid var(--vscode-panel-border);
        padding: 10px 12px 12px;
        background: #252526;
      }
      #agentPrompt { width: 100%; min-height: 88px; resize: vertical; border-radius: 6px; font-family: ui-monospace, Menlo, monospace; }
      .composer-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
      #sessionList {
        border: 1px solid #333;
        border-radius: 4px;
        overflow: auto;
        max-height: 200px;
        margin: 0 8px;
        background: #1e1e1e;
      }
      #sessionDirInfo { padding: 6px 10px; font-size: 10px; }
      #sessionPreview {
        font-size: 10px;
        white-space: pre-wrap;
        max-height: 120px;
        overflow: auto;
        margin: 8px;
        padding: 8px;
        background: #1e1e1e;
        border: 1px solid #333;
        border-radius: 4px;
        font-family: ui-monospace, Menlo, monospace;
      }
      #result { font-size: 10px; margin: 0 10px 8px; color: #9d9d9d; min-height: 14px; }
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
      .entry:hover { background: #2a2d2e; }
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
                <button type="button" onclick="startAgentRun()">Run</button>
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
              <div class="composer-actions">
                <span class="small muted">cwd: <span id="agentCwdLabel">…</span></span>
                <button type="button" onclick="startAgentRun()">Run agent</button>
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

          if (role === "tool") {            pushTrace(msg.content || "");
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
            const label =
              "[" +
              (s.updatedAt || "").replace("T", " ").slice(0, 19) +
              "] " +
              String(s.id || "").slice(0, 8) +
              "  " +
              (s.preview || "");
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
      async function startAgentRun() {
        const prompt = document.getElementById("agentPrompt").value.trim();
        if (!prompt) {
          appendChat("system", "Prompt is required.");
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
        const res = await fetch(withToken("/api/agent/start"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then((r) => r.json());
        if (!res.ok) {
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
        area.focus();
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
              (s.updatedAt || "").replace("T", " ").slice(0, 19) +
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
          evt.preventDefault();
          startAgentRun();
        }
      });
      refreshSessions();
      setInterval(refreshMetrics, 1000);
      if (EMBED_MODE) {
        document.body.classList.add("embed");
      }
    </script>
  </body>
</html>`;
}
