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
      .procRoot {
        padding: 8px 10px 10px;
        gap: 8px;
      }
      .procToolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .procInput {
        background: var(--bg);
        border: 1px solid var(--line);
        color: var(--text);
        border-radius: var(--radius-sm);
        padding: 6px 8px;
        font-size: 12px;
        min-width: 140px;
      }
      .procInput.procCommand { flex: 2; min-width: 220px; }
      .procInput.procMeta { flex: 1; }
      .procHint {
        margin: 0;
        font-size: 11px;
        color: var(--muted);
      }
      .procList {
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        background: var(--bg);
        padding: 6px;
        overflow: auto;
        min-height: 90px;
        max-height: 240px;
      }
      .procCard {
        border: 1px solid var(--line-faint);
        border-radius: 6px;
        padding: 6px 8px;
        margin-bottom: 6px;
        background: rgba(0,0,0,0.5);
      }
      .procCard:last-child { margin-bottom: 0; }
      .procCard.selected { border-color: var(--accent); }
      .procTitle { font-size: 12px; color: var(--text-neon); }
      .procSub { font-size: 11px; color: var(--muted); margin-top: 2px; }
      .procLog {
        margin: 0;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        background: var(--bg);
        padding: 8px;
        min-height: 120px;
        max-height: 220px;
        overflow: auto;
        font-size: 11px;
        line-height: 1.45;
        font-family: var(--font-mono);
        white-space: pre-wrap;
      }
      .plansRoot { padding: 10px; gap: 10px; }
      .plansHero {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--bg);
        padding: 10px;
      }
      .plansHeroTitle { color: var(--text-neon); font-size: 14px; font-weight: 700; }
      .plansHeroSub { color: var(--muted); font-size: 11px; margin-top: 2px; }
      .plansCreate { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; align-items: center; }
      .plansCreate .procInput { min-width: 220px; }
      .planHintPill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: 1px solid var(--line-faint);
        border-radius: 999px;
        padding: 3px 8px;
        background: rgba(0, 0, 0, 0.3);
        color: var(--muted);
      }
      .plansLayout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 10px; min-height: 0; flex: 1; }
      .plansSidebar {
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--bg);
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .plansSidebarHeader {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px;
        border-bottom: 1px solid var(--line-faint);
      }
      .plansSidebarTitle { color: var(--text-strong); font-size: 12px; font-weight: 700; }
      .plansList {
        border: 0;
        border-radius: 0;
        background: transparent;
        overflow: auto;
        min-height: 160px;
        max-height: none;
        padding: 8px;
        flex: 1;
      }
      .planItem {
        display: grid;
        gap: 5px;
        width: 100%;
        text-align: left;
        border: 1px solid var(--line-faint);
        background: rgba(0, 0, 0, 0.22);
        color: var(--text);
        padding: 9px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        margin-bottom: 7px;
        transition: border-color 0.15s, background 0.15s, transform 0.15s;
      }
      .planItem:hover { border-color: var(--line); background: rgba(34,211,238,0.06); transform: translateY(-1px); }
      .planItem.active { border-color: var(--accent); background: rgba(34,211,238,0.11); box-shadow: inset 3px 0 0 var(--accent); }
      .planItemTitle { color: var(--text-neon); font-size: 12px; font-weight: 700; line-height: 1.35; }
      .planMeta { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; font-size: 10px; color: var(--muted); }
      .planStatusPill, .planReadonlyPill {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--line-faint);
        border-radius: 999px;
        padding: 1px 7px;
        background: rgba(34, 211, 238, 0.06);
        color: var(--muted);
        font-size: 10px;
        line-height: 1.6;
        white-space: nowrap;
      }
      .planStatusPill { color: var(--text-strong); border-color: rgba(34, 211, 238, 0.22); }
      .planEditorHead {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        align-items: start;
        margin-bottom: 8px;
      }
      .planTitleBlock { min-width: 0; }
      .planDetailTitle { color: var(--text-neon); font-size: 14px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .planDetailMeta { color: var(--muted); font-size: 11px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .planActionBar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
      .planActionGroup {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        border: 1px solid var(--line-faint);
        border-radius: var(--radius-sm);
        padding: 6px;
        background: rgba(0, 0, 0, 0.18);
      }
      .planEditor {
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--bg);
        padding: 10px;
        display: flex;
        flex-direction: column;
        min-height: 0;
        height: 100%;
      }
      .planMd {
        width: 100%;
        min-height: 220px;
        height: 42vh;
        resize: vertical;
        font-family: ui-monospace, Menlo, monospace;
      }
      .planBody { display: flex; flex: 1; min-height: 0; }
      .planPreview {
        border: 1px solid var(--line-faint);
        border-radius: 6px;
        padding: 12px;
        margin-top: 0;
        flex: 1;
        min-height: 0;
        overflow: auto;
        max-height: none;
        font-size: 12px;
        background: rgba(0, 0, 0, 0.24);
        line-height: 1.58;
      }
      .planPreview h1, .planPreview h2, .planPreview h3 { color: var(--text-neon); margin: 1em 0 0.45em; }
      .planPreview h1 { font-size: 1.25rem; }
      .planPreview h2 { font-size: 1.05rem; }
      .planPreview h3 { font-size: 0.95rem; }
      .planPreview ul { padding-left: 20px; }
      .planPreview li { margin: 0.2em 0; }
      .planPreview code {
        font-family: var(--font-mono);
        border: 1px solid var(--line-faint);
        border-radius: 4px;
        padding: 1px 4px;
        background: rgba(34, 211, 238, 0.06);
      }
      .planPreview a { color: var(--accent-hover); }
      .planPreview.isHidden { display: none; }
      .planGraphPane {
        border: 1px solid var(--line-faint);
        border-radius: 6px;
        padding: 10px;
        flex: 1;
        overflow: auto;
        min-height: 0;
        min-width: 0;
        background: var(--bg);
      }
      .planGraphPane.planGraphFullscreenFallback {
        position: fixed;
        inset: 14px;
        z-index: 95;
        background: rgba(0, 0, 0, 0.97);
        border-color: var(--line);
        box-shadow: 0 0 0 1px var(--line-faint);
      }
      .planMdPane {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        min-width: 0;
      }
      .planMdPane.isHidden { display: none; }
      .planMdPane.planMdFullscreenFallback {
        position: fixed;
        inset: 14px;
        z-index: 95;
        background: rgba(0, 0, 0, 0.97);
        border: 1px solid var(--line);
        border-radius: 6px;
        box-shadow: 0 0 0 1px var(--line-faint);
        padding: 8px;
      }
      .planMdControls {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 6px;
      }
      .planModalBackdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        z-index: 200;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      .planModalBackdrop.isHidden { display: none; }
      .planModalDialog {
        background: rgba(10, 12, 16, 0.98);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
        max-width: 720px;
        width: 100%;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .planModalHeader {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--line-faint);
      }
      .planModalHeader strong { color: var(--text); font-size: 13px; }
      .planModalBody {
        padding: 10px 12px;
        overflow: auto;
        font-size: 12px;
      }
      .planModalClose {
        background: transparent;
        border: 1px solid var(--line-faint);
        color: var(--text);
        border-radius: 4px;
        cursor: pointer;
        padding: 2px 8px;
        font-size: 12px;
      }
      .planModalClose:hover { border-color: var(--line); }
      .planGraphPane.isHidden { display: none; }
      .planGraphSvg {
        width: 100%;
        min-height: 100%;
      }
      .planGraphHint {
        font-size: 11px;
        color: var(--muted);
        margin-top: 4px;
      }
      .planGraphControls {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 6px;
      }
      .planGhPanel {
        margin-bottom: 8px;
        border: 1px solid var(--accent);
        border-radius: var(--radius-sm);
        padding: 8px;
        background: var(--bg);
        overflow: auto;
      }
      .planGhPanel.isHidden { display: none; }
      .planGhToolbar {
        margin-bottom: 8px;
        border: 1px solid var(--accent);
        border-radius: var(--radius-sm);
        padding: 6px;
        background: var(--accent);
        color: #000000;
      }
      .planGhTitle {
        color: #000000;
        font-weight: 800;
        letter-spacing: 0.02em;
      }
      .planGhToolbar .procInput {
        border-color: #000000;
        background: #000000;
        color: var(--accent-hover);
      }
      .planGhToolbar .procInput::placeholder { color: rgba(103, 232, 249, 0.72); }
      .planGhToolbar .reconnect {
        border-color: #000000;
        background: #000000;
        color: var(--accent);
      }
      .planGhToolbar .reconnect:hover {
        background: var(--panel2);
        color: var(--accent-hover);
      }
      .planGhToolbar .procHint {
        color: #000000;
        font-weight: 700;
      }
      #btnPlanGithubPanel.planGhOpen {
        border-color: var(--accent);
        background: var(--accent);
        color: #000000;
        font-weight: 800;
      }
      .planGithubTaskList { display: grid; gap: 6px; font-size: 12px; }
      .planGhRow {
        display: grid;
        grid-template-columns: auto auto minmax(180px, 1fr) 160px 220px minmax(120px, auto) auto;
        align-items: center;
        gap: 8px;
        padding: 7px;
        border: 1px solid var(--line-faint);
        border-radius: var(--radius-sm);
        background: rgba(0, 0, 0, 0.2);
        min-width: 760px;
      }
      .planGhDone { opacity: 0.8; width: 14px; text-align: center; }
      .planGhLabel { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
          <span class="chip">2 agent · shell · docs · graph · plans · processes</span>
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
                <button type="button" class="paneTab" role="tab" aria-selected="false" data-pane2-tab="plans" id="pane2TabPlans">Plans</button>
                <button type="button" class="paneTab" role="tab" aria-selected="false" data-pane2-tab="processes" id="pane2TabProcesses">Processes</button>
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
            <div id="pane2Processes" class="pane2View isHidden procRoot" aria-hidden="true">
              <div class="procToolbar">
                <input id="procCommandInput" class="procInput procCommand" placeholder="npm run dev" />
                <input id="procLabelInput" class="procInput procMeta" placeholder="Label (optional)" />
                <input id="procTagsInput" class="procInput procMeta" placeholder="Tags (comma-separated)" />
                <button type="button" class="reconnect" id="btnProcStart">Start</button>
                <button type="button" class="reconnect" id="btnProcRefresh">Refresh</button>
              </div>
              <div class="procToolbar">
                <input id="procFilterInput" class="procInput procMeta" placeholder="Filter by name/command/tag..." />
                <select id="procStatusFilter" class="procInput procMeta">
                  <option value="all">all status</option>
                  <option value="running">running</option>
                  <option value="done">done</option>
                  <option value="error">error</option>
                  <option value="stopped">stopped</option>
                </select>
              </div>
              <p id="procHint" class="procHint">Project-scoped managed process list. Start relevant dev commands here.</p>
              <div id="procList" class="procList">Loading…</div>
              <div class="procHint">Selected process output (tail):</div>
              <pre id="procLogPreview" class="procLog">Select a process to inspect logs.</pre>
            </div>
            <div id="pane2Plans" class="pane2View isHidden plansRoot" aria-hidden="true">
              <div class="plansHero">
                <div>
                  <div class="plansHeroTitle">Planning Workspace</div>
                  <div class="plansHeroSub">Scope agent sessions, review rendered markdown, inspect graph structure, and sync selected tasks.</div>
                  <span id="planHint" class="planHintPill">Plans persist as <code>.winnow/plans/*.md</code> and sqlite metadata.</span>
                </div>
                <div class="plansCreate">
                  <input id="planTitleInput" class="procInput procCommand" placeholder="New plan title..." />
                  <button type="button" class="reconnect" id="btnPlanCreate">Create plan</button>
                  <button type="button" class="reconnect" id="btnPlanRefresh">Refresh</button>
                </div>
              </div>
              <div class="plansLayout">
                <div class="plansSidebar">
                  <div class="plansSidebarHeader">
                    <span class="plansSidebarTitle">Plans</span>
                    <span class="planReadonlyPill">agent-managed</span>
                  </div>
                  <div id="plansList" class="plansList">Loading plans…</div>
                </div>
                <div class="planEditor">
                  <div class="planEditorHead">
                    <div class="planTitleBlock">
                      <div id="planDetailTitle" class="planDetailTitle">Select a plan</div>
                      <div id="planDetailMeta" class="planDetailMeta">Choose a plan from the list to load its markdown and graph.</div>
                    </div>
                    <span class="planReadonlyPill" title="Plans are agent-managed; update by talking in Agent tab with the selected plan scope.">read-only preview</span>
                  </div>
                  <div class="planActionBar">
                    <div class="planActionGroup">
                      <input id="planTitleEdit" class="procInput procMeta" placeholder="Plan title" />
                      <input id="planStatusEdit" class="procInput procMeta" placeholder="Status" readonly />
                      <button type="button" class="reconnect" id="btnPlanRename">Rename</button>
                      <button type="button" class="reconnect" id="btnPlanOpenAgent">Open in Agent</button>
                    </div>
                    <div class="planActionGroup">
                      <button type="button" class="reconnect" id="btnPlanNormalize">Normalize</button>
                      <button type="button" class="reconnect" id="btnPlanReconcile" title="Reconcile rendered plan structure against agent updates and stored mappings">Reconcile</button>
                      <span id="planStructureBadge" class="planStatusPill">structure: unknown</span>
                    </div>
                    <div class="planActionGroup">
                      <button type="button" class="reconnect" id="btnPlanGraphView">Graph view</button>
                      <button type="button" class="reconnect" id="btnPlanGraphRebuild">Rebuild graph</button>
                      <button type="button" class="reconnect" id="btnPlanGithubPanel">GitHub mapping</button>
                    </div>
                  </div>
                  <div id="planGithubPanel" class="planGhPanel isHidden">
                    <div class="procToolbar planGhToolbar">
                      <strong class="planGhTitle">GitHub issue mapping</strong>
                      <input id="planGithubRepo" class="procInput procMeta" placeholder="owner/repo (optional, defaults to current)" style="min-width:240px;" />
                      <button type="button" class="reconnect" id="btnPlanGithubSyncSelected">Sync selected</button>
                      <button type="button" class="reconnect" id="btnPlanGithubDryRun">Dry run</button>
                      <button type="button" class="reconnect planGhClose" id="btnPlanGithubClose">Close</button>
                      <span id="planGithubStatus" class="procHint"></span>
                    </div>
                    <div id="planGithubTaskList" class="muted planGithubTaskList">Load a plan to see its tasks.</div>
                  </div>
                  <div id="planReconcileModal" class="planModalBackdrop isHidden" role="dialog" aria-modal="true" aria-labelledby="planReconcileModalTitle">
                    <div class="planModalDialog">
                      <div class="planModalHeader">
                        <strong id="planReconcileModalTitle">Reconcile result</strong>
                        <button type="button" class="planModalClose" id="btnPlanReconcileClose" aria-label="Close">Close ✕</button>
                      </div>
                      <div class="planModalBody" id="planReconcilePanel"></div>
                    </div>
                  </div>
                  <div id="planBody" class="planBody">
                    <div id="planMdPane" class="planMdPane">
                      <div class="planMdControls">
                        <button type="button" class="reconnect" id="btnPlanMdFullscreen">Fullscreen</button>
                      </div>
                      <div id="planPreview" class="planPreview muted">Preview will appear here.</div>
                    </div>
                    <div id="planGraphPane" class="planGraphPane isHidden">
                      <div class="planGraphControls">
                        <button type="button" class="reconnect" id="btnPlanGraphZoomIn">Zoom +</button>
                        <button type="button" class="reconnect" id="btnPlanGraphZoomOut">Zoom -</button>
                        <button type="button" class="reconnect" id="btnPlanGraphLeft">◀</button>
                        <button type="button" class="reconnect" id="btnPlanGraphRight">▶</button>
                        <button type="button" class="reconnect" id="btnPlanGraphUp">▲</button>
                        <button type="button" class="reconnect" id="btnPlanGraphDown">▼</button>
                        <button type="button" class="reconnect" id="btnPlanGraphReset">Reset view</button>
                        <button type="button" class="reconnect" id="btnPlanGraphFullscreen">Fullscreen</button>
                        <button type="button" class="reconnect" id="btnPlanGraphMode" title="Toggle Timeline / Tree layout">Mode: Timeline</button>
                      </div>
                      <svg id="planGraphSvg" class="planGraphSvg" viewBox="0 0 920 640" role="img" aria-label="Plan graph"></svg>
                      <div class="planGraphHint" id="planGraphHint">Timeline view (ordered top-to-bottom) with branch lanes and latest-worked highlight.</div>
                    </div>
                  </div>
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
      let processRefreshTimer = null;
      let plansRefreshTimer = null;
      let selectedManagedProcessId = null;
      let cachedManagedProcesses = [];
      let selectedPlanId = "";
      let cachedPlans = [];
      let planGraphVisible = true;
      let selectedPlanMarkdown = "";
      let selectedPlanUpdatedAt = "";
      let planGraphViewBox = { x: 0, y: 0, w: 980, h: 720, baseW: 980, baseH: 720 };
      let planGraphFullscreenFallback = false;
      let planMdFullscreenFallback = false;
      let planGraphMode = (function(){
        try { return localStorage.getItem("winnow.planGraphMode") || "timeline"; } catch { return "timeline"; }
      })();
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
      const PLAN_SELECTION_KEY = "winnow-active-plan-id";
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
        const plansEl = document.getElementById("pane2Plans");
        const procEl = document.getElementById("pane2Processes");
        const chip = document.getElementById("pane2ModeChip");
        const tw = document.getElementById("pane2TabWorkspace");
        const tt = document.getElementById("pane2TabTerminal");
        const td = document.getElementById("pane2TabDocs");
        const tg = document.getElementById("pane2TabGraph");
        const tplans = document.getElementById("pane2TabPlans");
        const tp = document.getElementById("pane2TabProcesses");
        const recon = document.getElementById("reconnectPane2");
        const isWs = mode === "workspace";
        const isTerm = mode === "terminal";
        const isDoc = mode === "docs";
        const isGraph = mode === "graph";
        const isPlans = mode === "plans";
        const isProc = mode === "processes";
        if(wsEl && tsEl && docEl && graphEl && plansEl && procEl){
          wsEl.classList.toggle("isHidden", !isWs);
          tsEl.classList.toggle("isHidden", !isTerm);
          docEl.classList.toggle("isHidden", !isDoc);
          graphEl.classList.toggle("isHidden", !isGraph);
          plansEl.classList.toggle("isHidden", !isPlans);
          procEl.classList.toggle("isHidden", !isProc);
          wsEl.setAttribute("aria-hidden", isWs ? "false" : "true");
          tsEl.setAttribute("aria-hidden", isTerm ? "false" : "true");
          docEl.setAttribute("aria-hidden", isDoc ? "false" : "true");
          graphEl.setAttribute("aria-hidden", isGraph ? "false" : "true");
          plansEl.setAttribute("aria-hidden", isPlans ? "false" : "true");
          procEl.setAttribute("aria-hidden", isProc ? "false" : "true");
        }
        if(chip){
          chip.textContent = isWs ? "winnow-agent-ui" : isTerm ? "shell" : isDoc ? "md · pdf" : isGraph ? "project graph" : isPlans ? "plan board" : "managed processes";
        }
        if(tw && tt && td && tg && tplans && tp){
          tw.classList.toggle("paneTabActive", isWs);
          tt.classList.toggle("paneTabActive", isTerm);
          td.classList.toggle("paneTabActive", isDoc);
          tg.classList.toggle("paneTabActive", isGraph);
          tplans.classList.toggle("paneTabActive", isPlans);
          tp.classList.toggle("paneTabActive", isProc);
          tw.setAttribute("aria-selected", isWs.toString());
          tt.setAttribute("aria-selected", isTerm.toString());
          td.setAttribute("aria-selected", isDoc.toString());
          tg.setAttribute("aria-selected", isGraph.toString());
          tplans.setAttribute("aria-selected", isPlans.toString());
          tp.setAttribute("aria-selected", isProc.toString());
        }
        if(recon){ recon.hidden = !isTerm; }
        if(processRefreshTimer){
          clearInterval(processRefreshTimer);
          processRefreshTimer = null;
        }
        if(plansRefreshTimer){
          clearInterval(plansRefreshTimer);
          plansRefreshTimer = null;
        }
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
        if(isProc){
          void refreshManagedProcesses();
          processRefreshTimer = setInterval(function(){
            void refreshManagedProcesses();
            if(selectedManagedProcessId){
              void refreshManagedProcessLog(selectedManagedProcessId);
            }
          }, 4000);
        }
        if(isPlans){
          void refreshPlans(true);
          plansRefreshTimer = setInterval(function(){
            void refreshPlans(true);
          }, 5000);
        }
      }
      function renderPlanPreview(markdown){
        const root = document.getElementById("planPreview");
        if(!root){ return; }
        const raw = String(markdown || "");
        if(!raw.trim()){
          root.textContent = "Preview will appear here.";
          return;
        }
        try {
          if(typeof marked === "undefined" || typeof DOMPurify === "undefined"){
            root.textContent = raw;
            return;
          }
          const html = marked.parse(raw, { breaks: true, gfm: true });
          root.innerHTML = DOMPurify.sanitize(String(html));
        } catch {
          root.textContent = raw;
        }
      }
      function parsePlanGraph(markdown){
        const normalized = String(markdown || "").split("\\r").join("");
        const lines = normalized.split("\\n");
        const nodes = [];
        const edges = [];
        let idCounter = 0;
        const stack = [];
        let latestWorkedId = "";
        const taskDepthStack = [];
        for(const raw of lines){
          const line = String(raw || "");
          const heading = line.match(/^(#{1,4})\\s+(.+)$/);
          if(heading){
            const depth = heading[1].length;
            const title = heading[2].trim();
            const id = "h-" + (++idCounter);
            nodes.push({ id, label: title, depth, kind: "heading" });
            while(stack.length > 0 && stack[stack.length - 1].depth >= depth){
              stack.pop();
            }
            taskDepthStack.length = 0;
            if(stack.length > 0){
              edges.push({ from: stack[stack.length - 1].id, to: id });
            }
            stack.push({ id, depth });
            continue;
          }
          const task = line.match(/^(\\s*)-\\s+\\[( |x|X)\\]\\s+(.+)$/);
          if(task){
            const indent = String(task[1] || "").replace(/\t/g, "  ").length;
            const indentLevels = Math.floor(indent / 2);
            const done = String(task[2] || "").toLowerCase() === "x";
            const label = task[3].trim();
            const sectionDepth = stack[stack.length - 1]?.depth || 1;
            const depth = sectionDepth + 1 + indentLevels;
            while(taskDepthStack.length > 0 && taskDepthStack[taskDepthStack.length - 1].indentLevels >= indentLevels){
              taskDepthStack.pop();
            }
            const parentTask = taskDepthStack.length > 0 ? taskDepthStack[taskDepthStack.length - 1] : null;
            const optional = Boolean(parentTask);
            const id = "t-" + (++idCounter);
            // Priority tier: 1 = primary task, 2 = direct sidequest,
            // 3+ = deeper-nested optional sidequest (lower priority).
            const priority = optional ? Math.max(2, indentLevels + 1) : 1;
            const tierTag = optional
              ? (priority >= 3 ? "  [sidequest p" + priority + "]" : "  [sidequest]")
              : "";
            nodes.push({
              id,
              label: (done ? "✓ " : "○ ") + label + tierTag,
              depth,
              kind: optional ? "sidequest" : "task",
              optional,
              priority,
              done,
            });
            if(parentTask){
              edges.push({ from: parentTask.id, to: id });
            } else if(stack.length > 0){
              edges.push({ from: stack[stack.length - 1].id, to: id });
            }
            taskDepthStack.push({ id, indentLevels });
            if(done){
              latestWorkedId = id;
            }
          }
        }
        if(!latestWorkedId && nodes.length > 0){
          latestWorkedId = nodes[nodes.length - 1].id;
        }
        return { nodes, edges, latestWorkedId };
      }
      function evaluatePlanStructure(markdown){
        const raw = String(markdown || "");
        const normalized = raw.split("\\r").join("");
        const lines = normalized.split("\\n");
        const sections = new Set();
        let headingCount = 0;
        let taskCount = 0;
        for(const lineRaw of lines){
          const line = String(lineRaw || "");
          const h2 = line.match(/^##\\s+(.+)$/);
          if(h2){
            sections.add(String(h2[1] || "").trim().toLowerCase());
          }
          if(/^(#{1,4})\\s+/.test(line)){ headingCount += 1; }
          if(/^\\s*-\\s+\\[( |x|X)\\]\\s+/.test(line)){ taskCount += 1; }
        }
        const required = ["goal","completed","in progress","next tasks","validation checklist"];
        const missing = required.filter((name)=>!sections.has(name));
        const canonical = missing.length === 0 && headingCount >= 3 && taskCount >= 3;
        return { canonical, missing, headingCount, taskCount };
      }
      function updatePlanStructureBadge(markdown){
        const badge = document.getElementById("planStructureBadge");
        if(!badge){ return; }
        const report = evaluatePlanStructure(markdown);
        if(report.canonical){
          badge.textContent = "structure: canonical";
          badge.style.color = "#86efac";
          badge.title = "Plan structure is graph-friendly.";
          return;
        }
        badge.textContent = "structure: needs normalize";
        badge.style.color = "#facc15";
        badge.title = "Missing sections: " + (report.missing.join(", ") || "n/a");
      }
      function escXml(s){
        return String(s == null ? "" : s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }
      function wrapLabel(label, maxChars){
        const normalized = String(label || "").trim();
        const softWords = normalized.split(/\\s+/).filter(Boolean);
        const words = [];
        for(const token of softWords){
          if(token.length <= maxChars){
            words.push(token);
            continue;
          }
          for(let i = 0; i < token.length; i += maxChars){
            words.push(token.slice(i, i + maxChars));
          }
        }
        if(words.length === 0){ return [""]; }
        const lines = [];
        let cur = "";
        for(const w of words){
          if(!cur){
            cur = w;
            continue;
          }
          if((cur + " " + w).length <= maxChars){
            cur += " " + w;
          } else {
            lines.push(cur);
            cur = w;
          }
        }
        if(cur){ lines.push(cur); }
        return lines.slice(0, 4);
      }
      function applyPlanGraphViewBox(){
        const svg = document.getElementById("planGraphSvg");
        if(!svg){ return; }
        svg.setAttribute(
          "viewBox",
          planGraphViewBox.x + " " + planGraphViewBox.y + " " + planGraphViewBox.w + " " + planGraphViewBox.h
        );
      }
      function zoomPlanGraph(scale){
        const s = Number(scale) || 1;
        if(!Number.isFinite(s) || s <= 0){ return; }
        const cx = planGraphViewBox.x + planGraphViewBox.w / 2;
        const cy = planGraphViewBox.y + planGraphViewBox.h / 2;
        planGraphViewBox.w = Math.max(320, Math.min(planGraphViewBox.baseW * 3, planGraphViewBox.w / s));
        planGraphViewBox.h = Math.max(220, Math.min(planGraphViewBox.baseH * 3, planGraphViewBox.h / s));
        planGraphViewBox.x = cx - planGraphViewBox.w / 2;
        planGraphViewBox.y = cy - planGraphViewBox.h / 2;
        applyPlanGraphViewBox();
      }
      function panPlanGraph(dx, dy){
        planGraphViewBox.x += Number(dx) || 0;
        planGraphViewBox.y += Number(dy) || 0;
        applyPlanGraphViewBox();
      }
      function updatePlanGraphFullscreenButton(){
        const btn = document.getElementById("btnPlanGraphFullscreen");
        if(!btn){ return; }
        const active = Boolean(document.fullscreenElement) || planGraphFullscreenFallback;
        btn.textContent = active ? "Exit fullscreen" : "Fullscreen";
      }
      async function togglePlanGraphFullscreen(){
        const pane = document.getElementById("planGraphPane");
        if(!pane){ return; }
        try {
          if(document.fullscreenElement){
            await document.exitFullscreen();
            updatePlanGraphFullscreenButton();
            return;
          }
          if(typeof pane.requestFullscreen === "function"){
            await pane.requestFullscreen();
            updatePlanGraphFullscreenButton();
            return;
          }
        } catch (_err) {}
        planGraphFullscreenFallback = !planGraphFullscreenFallback;
        pane.classList.toggle("planGraphFullscreenFallback", planGraphFullscreenFallback);
        updatePlanGraphFullscreenButton();
      }
      function updatePlanMdFullscreenButton(){
        const btn = document.getElementById("btnPlanMdFullscreen");
        if(!btn){ return; }
        const pane = document.getElementById("planMdPane");
        const nativeActive = Boolean(document.fullscreenElement) && document.fullscreenElement === pane;
        const active = nativeActive || planMdFullscreenFallback;
        btn.textContent = active ? "Exit fullscreen" : "Fullscreen";
      }
      async function togglePlanMdFullscreen(){
        const pane = document.getElementById("planMdPane");
        if(!pane){ return; }
        try {
          if(document.fullscreenElement === pane){
            await document.exitFullscreen();
            updatePlanMdFullscreenButton();
            return;
          }
          if(typeof pane.requestFullscreen === "function" && !document.fullscreenElement){
            await pane.requestFullscreen();
            updatePlanMdFullscreenButton();
            return;
          }
        } catch (_err) {}
        planMdFullscreenFallback = !planMdFullscreenFallback;
        pane.classList.toggle("planMdFullscreenFallback", planMdFullscreenFallback);
        updatePlanMdFullscreenButton();
      }
      function openPlanReconcileModal(){
        const modal = document.getElementById("planReconcileModal");
        if(modal){ modal.classList.remove("isHidden"); }
      }
      function closePlanReconcileModal(){
        const modal = document.getElementById("planReconcileModal");
        if(modal){ modal.classList.add("isHidden"); }
      }
      function renderPlanGraph(markdown){
        const svg = document.getElementById("planGraphSvg");
        if(!svg){ return; }
        const parsed = parsePlanGraph(markdown);
        let nodes = Array.isArray(parsed.nodes) ? [...parsed.nodes] : [];
        let edges = Array.isArray(parsed.edges) ? [...parsed.edges] : [];
        const latestWorkedId = String(parsed.latestWorkedId || "");
        if(nodes.length === 0){
          svg.innerHTML = '<text x="24" y="40" fill="#67e8f9" font-size="14">No headings/checklist items found in this plan.</text>';
          return;
        }
        const marginX = 28;
        const marginY = 24;
        const rowGap = 8;
        const colGap = 72;
        const baseNodeW = 290;
        const minNodeW = 210;
        const maxNodeW = 380;
        const maxDepth = nodes.reduce((acc, n)=>Math.max(acc, Number(n.depth || 1)), 1);
        const paneWidth = Math.max(0, Math.floor(svg.getBoundingClientRect().width || svg.clientWidth || 0));
        const innerWidth = Math.max(560, paneWidth - 16);
        const laneCount = Math.max(1, maxDepth);
        const availableNodeW = Math.floor((innerWidth - (marginX * 2) - ((laneCount - 1) * colGap)) / laneCount);
        const nodeW = Math.max(minNodeW, Math.min(maxNodeW, availableNodeW > 0 ? availableNodeW : baseNodeW));
        const colW = nodeW + colGap;
        const nodeById = new Map(nodes.map((n)=>[String(n.id), n]));
        const parentById = new Map();
        const childrenById = new Map();
        for(const n of nodes){
          childrenById.set(String(n.id), []);
        }
        for(const e of edges){
          const from = String(e.from || "");
          const to = String(e.to || "");
          if(!childrenById.has(from)){ childrenById.set(from, []); }
          childrenById.get(from).push(to);
          parentById.set(to, from);
        }
        // Hide empty heading leaves (e.g. headings with no task/content descendants).
        const isHeadingById = new Map(nodes.map((n)=>[String(n.id), String(n.kind) === "heading"]));
        const removable = new Set();
        for(const n of nodes){
          const id = String(n.id || "");
          const children = childrenById.get(id) || [];
          if(String(n.kind) === "heading" && children.length === 0){
            removable.add(id);
          }
        }
        if(removable.size > 0){
          nodes = nodes.filter((n)=>!removable.has(String(n.id || "")));
          edges = edges.filter((e)=>!removable.has(String(e.from || "")) && !removable.has(String(e.to || "")));
          childrenById.clear();
          parentById.clear();
          for(const n of nodes){
            childrenById.set(String(n.id), []);
          }
          for(const e of edges){
            const from = String(e.from || "");
            const to = String(e.to || "");
            if(!childrenById.has(from)){ childrenById.set(from, []); }
            childrenById.get(from).push(to);
            parentById.set(to, from);
          }
        }
        const roots = nodes.filter((n)=>!parentById.has(String(n.id))).map((n)=>String(n.id));
        const visitOrder = new Map(nodes.map((n, idx)=>[String(n.id), idx]));
        for(const arr of childrenById.values()){
          arr.sort((a,b)=>(visitOrder.get(a) || 0) - (visitOrder.get(b) || 0));
        }
        const positions = new Map();
        function ensureNodeSize(id){
          const n = nodeById.get(id);
          if(!n){
            return { wrapped: [""], h: 30 };
          }
          const depth = Math.max(1, Number(n.depth || 1));
          const width = depth >= maxDepth ? Math.min(maxNodeW + 60, innerWidth - marginX - 20) : nodeW;
          const wrapped = wrapLabel(n.label, Math.max(26, Math.floor((width - 24) / 7)));
          const h = Math.max(32, 12 + wrapped.length * 12);
          return { wrapped, h, width };
        }
        let cursorY = marginY;
        function gapForDepth(depth){
          const d = Math.max(1, Number(depth || 1));
          if(d >= maxDepth){ return 4; }
          if(d >= 3){ return 6; }
          return rowGap;
        }
        function layoutNode(id){
          const n = nodeById.get(id);
          if(!n){ return cursorY; }
          const { wrapped, h, width } = ensureNodeSize(id);
          const depth = Math.max(1, Number(n.depth || 1));
          const x = marginX + (depth - 1) * colW;
          const children = childrenById.get(id) || [];
          if(children.length === 0){
            const y = cursorY;
            positions.set(id, { x, y, w: width, h, wrapped, kind: n.kind });
            cursorY += h + gapForDepth(depth);
            return y + h / 2;
          }
          const centers = children.map((childId)=>layoutNode(childId));
          const centerY = centers.length ? (centers[0] + centers[centers.length - 1]) / 2 : (cursorY + h / 2);
          const y = centerY - h / 2;
          positions.set(id, { x, y, w: width, h, wrapped, kind: n.kind });
          return centerY;
        }
        if(planGraphMode === "timeline"){
          // Pure document order: each node gets its own row at marginY + i*rowH.
          // Depth still controls horizontal lane.
          const ordered = nodes.map((n)=>String(n.id));
          let yCursor = marginY;
          for(const id of ordered){
            const n = nodeById.get(id);
            if(!n){ continue; }
            const { wrapped, h, width } = ensureNodeSize(id);
            const depth = Math.max(1, Number(n.depth || 1));
            const x = marginX + (depth - 1) * colW;
            positions.set(id, { x, y: yCursor, w: width, h, wrapped, kind: n.kind });
            yCursor += h + gapForDepth(depth);
          }
          cursorY = yCursor;
        } else {
          for(const root of roots){
            layoutNode(root);
            cursorY += 4;
          }
        }
        const edgeSvg = edges.map((e, idx)=>{
          const a = positions.get(String(e.from || ""));
          const b = positions.get(String(e.to || ""));
          if(!a || !b){ return ""; }
          const targetNode = nodeById.get(String(e.to || ""));
          const targetPriority = Math.max(1, Number(targetNode?.priority || (targetNode?.kind === "sidequest" ? 2 : 1)));
          const isLowPriEdge = targetNode?.kind === "sidequest" && targetPriority >= 3;
          const x1 = a.x + a.w;
          const y1 = a.y + a.h / 2;
          const x2 = b.x;
          const y2 = b.y + b.h / 2;
          const laneShift = (idx % 3) * 4;
          const dx = Math.max(32, (x2 - x1) * 0.42 + laneShift);
          const c1x = x1 + dx;
          const c2x = x2 - Math.max(18, dx * 0.45);
          const edgeStroke = isLowPriEdge
            ? "rgba(250,204,21," + Math.max(0.18, 0.42 - (targetPriority - 2) * 0.08).toFixed(3) + ")"
            : "rgba(34,211,238,0.42)";
          const edgeDash = isLowPriEdge ? ' stroke-dasharray="2 3"' : "";
          return '<path d="M ' + x1 + ' ' + y1 + ' C ' + c1x + ' ' + y1 + ', ' + c2x + ' ' + y2 + ', ' + x2 + ' ' + y2 + '" stroke="' + edgeStroke + '" fill="none" stroke-width="1.2"' + edgeDash + '/>';
        }).join("");
        const nodeSvg = nodes.map((n)=>{
          const p = positions.get(n.id);
          if(!p){ return ""; }
          const isLatest = n.id === latestWorkedId;
          const priority = Math.max(1, Number(n.priority || (n.kind === "sidequest" ? 2 : 1)));
          // Optional sidequests at priority 3+ are styled lighter, more dashed,
          // and italicized to signal lower priority.
          const isLowPriSidequest = n.kind === "sidequest" && priority >= 3;
          const sidequestFillAlpha = isLowPriSidequest ? Math.max(0.04, 0.10 - (priority - 2) * 0.02) : 0.10;
          const sidequestStrokeAlpha = isLowPriSidequest ? Math.max(0.32, 0.7 - (priority - 2) * 0.12) : 0.7;
          const fill = isLatest
            ? "rgba(74,222,128,0.16)"
            : n.kind === "heading"
              ? "rgba(34,211,238,0.12)"
              : n.kind === "sidequest"
                ? "rgba(250,204,21," + sidequestFillAlpha.toFixed(3) + ")"
                : "rgba(167,139,250,0.10)";
          const stroke = isLatest
            ? "rgba(74,222,128,0.85)"
            : n.kind === "heading"
              ? "rgba(34,211,238,0.55)"
              : n.kind === "sidequest"
                ? "rgba(250,204,21," + sidequestStrokeAlpha.toFixed(3) + ")"
                : "rgba(167,139,250,0.45)";
          const dashArray = n.kind === "sidequest"
            ? (isLowPriSidequest ? "2 3" : "4 3")
            : "";
          const strokeWidth = isLatest ? 1.8 : (isLowPriSidequest ? 0.9 : 1.1);
          const textColor = isLowPriSidequest ? "#fde68a" : "#67e8f9";
          const textStyle = isLowPriSidequest ? ' font-style="italic" opacity="0.85"' : "";
          const textLines = (p.wrapped || [n.label]).map((line, idx)=>{
            return '<tspan x="' + (p.x + 10) + '" y="' + (p.y + 16 + idx * 12) + '">' + escXml(line) + '</tspan>';
          }).join("");
          const priorityBadge = isLowPriSidequest
            ? '<text x="' + (p.x + p.w - 28) + '" y="' + (p.y + 12) + '" fill="rgba(250,204,21,0.85)" font-size="9">p' + priority + '</text>'
            : '';
          return '<g>' +
            '<rect x="' + p.x + '" y="' + p.y + '" rx="6" ry="6" width="' + p.w + '" height="' + p.h + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '" stroke-dasharray="' + dashArray + '"/>' +
            '<text fill="' + textColor + '" font-size="11" xml:space="preserve"' + textStyle + '>' + textLines + '</text>' +
            priorityBadge +
            (isLatest ? ('<text x="' + (p.x + p.w - 62) + '" y="' + (p.y + p.h - 6) + '" fill="#86efac" font-size="10">latest</text>') : '') +
          '</g>';
        }).join("");
        const contentWidth = Math.max(...[...positions.values()].map((p)=>p.x + p.w + 30), innerWidth);
        const contentHeight = Math.max(...[...positions.values()].map((p)=>p.y + p.h + 16), 420);
        const width = Math.max(innerWidth, contentWidth);
        const height = Math.max(420, contentHeight);
        planGraphViewBox = { x: 0, y: 0, w: width, h: height, baseW: width, baseH: height };
        svg.setAttribute("viewBox", "0 0 " + width + " " + height);
        svg.innerHTML = edgeSvg + nodeSvg;
        // wheel zoom
        if(!svg.dataset.planWheelBound){
          svg.addEventListener("wheel", (evt)=>{
            evt.preventDefault();
            const dir = evt.deltaY > 0 ? 0.9 : 1.1;
            zoomPlanGraph(dir);
          }, { passive: false });
          svg.dataset.planWheelBound = "1";
        }
      }
      function setPlanGraphVisibility(visible){
        planGraphVisible = Boolean(visible);
        const pane = document.getElementById("planGraphPane");
        const mdPane = document.getElementById("planMdPane");
        const btn = document.getElementById("btnPlanGraphView");
        if(pane){ pane.classList.toggle("isHidden", !planGraphVisible); }
        if(mdPane){ mdPane.classList.toggle("isHidden", planGraphVisible); }
        if(btn){ btn.textContent = planGraphVisible ? "Rendered view" : "Graph view"; }
      }
      async function rebuildPlanGraph(){
        const hint = document.getElementById("planHint");
        if(!selectedPlanId){
          if(hint){ hint.textContent = "Select a plan first."; }
          return;
        }
        try {
          const d = await fetch(withToken("/api/plans/" + encodeURIComponent(selectedPlanId))).then((r)=>r.json());
          if(!d || d.ok === false){
            if(hint){ hint.textContent = "Rebuild failed: " + ((d && d.error) || "unknown error"); }
            return;
          }
          selectedPlanMarkdown = String(d.markdown || "");
          renderPlanGraph(selectedPlanMarkdown);
          if(hint){ hint.textContent = "Graph rebuilt from latest plan markdown."; }
        } catch (err) {
          if(hint){ hint.textContent = "Rebuild failed: " + ((err && err.message) ? err.message : String(err)); }
        }
      }
      async function loadPlan(id){
        if(!id){ return; }
        selectedPlanId = id;
        const titleEl = document.getElementById("planTitleEdit");
        const statusEl = document.getElementById("planStatusEdit");
        const detailTitle = document.getElementById("planDetailTitle");
        const detailMeta = document.getElementById("planDetailMeta");
        const hint = document.getElementById("planHint");
        try {
          const meta = cachedPlans.find((p)=>String(p.id) === String(id));
          if(titleEl && meta){ titleEl.value = String(meta.title || id); }
          if(statusEl && meta && meta.status){ statusEl.value = String(meta.status); }
          selectedPlanUpdatedAt = meta && meta.updatedAt ? String(meta.updatedAt) : selectedPlanUpdatedAt;
          if(detailTitle){ detailTitle.textContent = String((meta && meta.title) || id); }
          if(detailMeta){
            const status = String((meta && meta.status) || "draft");
            const ts = meta && meta.updatedAt ? new Date(String(meta.updatedAt)).toLocaleString() : "";
            detailMeta.textContent = "id: " + id + " | " + status + (ts ? " | updated " + ts : "");
          }
          const d = await fetch(withToken("/api/plans/" + encodeURIComponent(id))).then((r)=>r.json());
          if(d && d.ok){
            if(titleEl && d.title){ titleEl.value = String(d.title); }
            if(detailTitle){ detailTitle.textContent = String(d.title || (meta && meta.title) || id); }
            selectedPlanMarkdown = String(d.markdown || "");
            renderPlanPreview(selectedPlanMarkdown);
            renderPlanGraph(selectedPlanMarkdown);
            updatePlanStructureBadge(selectedPlanMarkdown);
            if(hint){ hint.textContent = "Plan loaded."; }
            try {
              const ghPane = document.getElementById("planGithubPanel");
              if(ghPane && !ghPane.classList.contains("isHidden")){
                if(typeof loadPlanGithubTasks === "function"){ void loadPlanGithubTasks(); }
              }
            } catch {}
          } else if(hint){
            hint.textContent = "Load failed: " + ((d && d.error) || "unknown error");
          }
        } catch (err) {
          if(hint){ hint.textContent = "Load failed: " + ((err && err.message) ? err.message : String(err)); }
        }
        const list = document.getElementById("plansList");
        if(list){
          list.querySelectorAll(".planItem").forEach((el)=>{
            el.classList.toggle("active", el.getAttribute("data-plan-id") === selectedPlanId);
          });
        }
      }
      async function refreshPlans(syncSelected){
        const list = document.getElementById("plansList");
        if(!list){ return; }
        try {
          const d = await fetch(withToken("/api/plans")).then((r)=>r.json());
          cachedPlans = (d && d.ok && Array.isArray(d.plans)) ? d.plans : [];
          if(cachedPlans.length === 0){
            list.innerHTML = '<div class="procSub">No plans yet. Create one above.</div>';
            selectedPlanId = "";
            selectedPlanUpdatedAt = "";
            return;
          }
          list.innerHTML = cachedPlans.map((p)=>{
            const active = selectedPlanId && String(p.id) === selectedPlanId;
            const ts = p.updatedAt ? new Date(String(p.updatedAt)).toLocaleString() : "";
            const status = String(p.status || "draft");
            return '<button type="button" class="planItem' + (active ? ' active' : '') + '" data-plan-id="' + escHtml(p.id) + '">' +
              '<div class="planItemTitle">' + escHtml(p.title || p.id) + '</div>' +
              '<div class="planMeta">' +
                '<span class="planStatusPill">' + escHtml(status) + '</span>' +
                (ts ? '<span>Updated ' + escHtml(ts) + '</span>' : '') +
              '</div>' +
            '</button>';
          }).join("");
          list.querySelectorAll(".planItem").forEach((el)=>{
            el.addEventListener("click", ()=>{ void loadPlan(el.getAttribute("data-plan-id") || ""); });
          });
          if(!selectedPlanId){
            await loadPlan(String(cachedPlans[0].id || ""));
            return;
          }
          if(syncSelected){
            const selectedMeta = cachedPlans.find((p)=>String(p.id) === String(selectedPlanId));
            if(!selectedMeta){
              await loadPlan(String(cachedPlans[0].id || ""));
              return;
            }
            const nextUpdatedAt = String(selectedMeta.updatedAt || "");
            if(nextUpdatedAt && nextUpdatedAt !== selectedPlanUpdatedAt){
              await loadPlan(selectedPlanId);
            }
          }
        } catch (err) {
          list.textContent = "Failed to load plans: " + ((err && err.message) ? err.message : String(err));
        }
      }
      async function createPlan(){
        const titleEl = document.getElementById("planTitleInput");
        const hint = document.getElementById("planHint");
        const title = String(titleEl && titleEl.value || "").trim() || "Untitled plan";
        try {
          const d = await fetch(withToken("/api/plans"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
          }).then((r)=>r.json());
          if(!d || d.ok === false){
            if(hint){ hint.textContent = "Create failed: " + ((d && d.error) || "unknown error"); }
            return;
          }
          if(titleEl){ titleEl.value = ""; }
          selectedPlanId = String(d.plan && d.plan.id || "");
          await refreshPlans(true);
          if(selectedPlanId){ await loadPlan(selectedPlanId); }
          if(hint){ hint.textContent = "Plan created."; }
        } catch (err) {
          if(hint){ hint.textContent = "Create failed: " + ((err && err.message) ? err.message : String(err)); }
        }
      }
      async function renamePlanTitle(){
        const hint = document.getElementById("planHint");
        if(!selectedPlanId){
          if(hint){ hint.textContent = "Select a plan first."; }
          return;
        }
        const title = String(document.getElementById("planTitleEdit")?.value || "").trim();
        if(!title){
          if(hint){ hint.textContent = "Enter a non-empty title."; }
          return;
        }
        try {
          const d = await fetch(withToken("/api/plans/" + encodeURIComponent(selectedPlanId)), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
          }).then((r)=>r.json());
          if(!d || d.ok === false){
            if(hint){ hint.textContent = "Rename failed: " + ((d && d.error) || "unknown error"); }
            return;
          }
          await refreshPlans(true);
          if(hint){ hint.textContent = "Title updated."; }
        } catch (err) {
          if(hint){ hint.textContent = "Rename failed: " + ((err && err.message) ? err.message : String(err)); }
        }
      }
      function openAgentWithSelectedPlan(){
        const hint = document.getElementById("planHint");
        if(!selectedPlanId){
          if(hint){ hint.textContent = "Select a plan first."; }
          return;
        }
        try {
          localStorage.setItem(PLAN_SELECTION_KEY, String(selectedPlanId));
        } catch (_err) {}
        setPane2Tab("workspace");
        const applyToIframe = ()=>{
          const frame = document.querySelector("#pane2Workspace iframe");
          const frameDoc = frame && frame.contentWindow ? frame.contentWindow.document : null;
          const sel = frameDoc ? frameDoc.getElementById("agentPlanSelect") : null;
          if(sel){
            sel.value = String(selectedPlanId);
            sel.dispatchEvent(new Event("change", { bubbles: true }));
          }
        };
        setTimeout(applyToIframe, 120);
        setTimeout(applyToIframe, 420);
        if(hint){ hint.textContent = "Opened Agent tab with this plan selected."; }
      }
      async function normalizeSelectedPlan(){
        const hint = document.getElementById("planHint");
        if(!selectedPlanId){
          if(hint){ hint.textContent = "Select a plan first."; }
          return;
        }
        try {
          const d = await fetch(withToken("/api/plans/" + encodeURIComponent(selectedPlanId) + "/normalize"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          }).then((r)=>r.json());
          if(!d || d.ok === false){
            if(hint){ hint.textContent = "Normalize failed: " + ((d && d.error) || "unknown error"); }
            return;
          }
          await refreshPlans(true);
          await loadPlan(selectedPlanId);
          updatePlanStructureBadge(selectedPlanMarkdown);
          if(hint){ hint.textContent = "Plan normalized to canonical structure."; }
        } catch (err) {
          if(hint){ hint.textContent = "Normalize failed: " + ((err && err.message) ? err.message : String(err)); }
        }
      }
      async function refreshManagedProcessLog(id){
        const pre = document.getElementById("procLogPreview");
        if(!pre || !id){ return; }
        pre.textContent = "Loading log…";
        try {
          const data = await fetch(withToken("/api/processes/" + encodeURIComponent(id) + "/log?tail=220")).then((r)=>r.json());
          if(!data || data.ok === false){
            pre.textContent = "Log unavailable: " + ((data && data.error) || "unknown error");
            return;
          }
          pre.textContent = String(data.content || "").trim() || "(no output yet)";
        } catch (err) {
          pre.textContent = "Failed to load logs: " + ((err && err.message) ? err.message : String(err));
        }
      }
      async function stopManagedProcess(id){
        const hint = document.getElementById("procHint");
        try {
          const data = await fetch(withToken("/api/processes/" + encodeURIComponent(id) + "/stop"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          }).then((r)=>r.json());
          if(hint){
            hint.textContent = data && data.ok
              ? (data.stopped ? "Process stopped." : (data.message || "Process already not running."))
              : ("Stop failed: " + ((data && data.error) || "unknown error"));
          }
        } catch (err) {
          if(hint){ hint.textContent = "Stop failed: " + ((err && err.message) ? err.message : String(err)); }
        }
        await refreshManagedProcesses();
      }
      async function viewManagedProcessLog(id){
        selectedManagedProcessId = id;
        await refreshManagedProcesses();
        await refreshManagedProcessLog(id);
      }
      async function refreshManagedProcesses(){
        const list = document.getElementById("procList");
        const pre = document.getElementById("procLogPreview");
        if(!list){ return; }
        try {
          const data = await fetch(withToken("/api/processes")).then((r)=>r.json());
          const rows = (data && data.processes) || [];
          cachedManagedProcesses = Array.isArray(rows) ? rows : [];
          const q = String(document.getElementById("procFilterInput")?.value || "").trim().toLowerCase();
          const statusFilter = String(document.getElementById("procStatusFilter")?.value || "all").trim().toLowerCase();
          const filtered = cachedManagedProcesses.filter((p)=>{
            const statusOk = statusFilter === "all" ? true : String(p.status || "").toLowerCase() === statusFilter;
            if(!statusOk){ return false; }
            if(!q){ return true; }
            const hay = [
              String(p.label || ""),
              String(p.command || ""),
              String(p.cwd || ""),
              ...(Array.isArray(p.tags) ? p.tags.map((x)=>String(x)) : []),
            ].join(" ").toLowerCase();
            return hay.includes(q);
          });
          const tagCounts = new Map();
          for(const p of filtered){
            for(const t of (Array.isArray(p.tags) ? p.tags : [])){
              const key = String(t || "").trim();
              if(!key){ continue; }
              tagCounts.set(key, (tagCounts.get(key) || 0) + 1);
            }
          }
          const topTags = [...tagCounts.entries()]
            .sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]))
            .slice(0, 8)
            .map(([k,v])=>k + "×" + v)
            .join(", ");
          if(rows.length === 0){
            list.innerHTML = '<div class="procSub">No managed processes yet. Start one above (e.g., <code>npm run dev</code>).</div>';
            if(pre && !selectedManagedProcessId){ pre.textContent = "Select a process to inspect logs."; }
            return;
          }
          if(filtered.length === 0){
            list.innerHTML = '<div class="procSub">No processes match the current filters.</div>';
            return;
          }
          list.innerHTML = (topTags ? ('<div class="procSub" style="margin:2px 2px 6px 2px">Top tags: ' + escHtml(topTags) + "</div>") : "") + filtered.map(function(p){
            const running = p.status === "running";
            const selected = selectedManagedProcessId === p.id;
            const tags = Array.isArray(p.tags) && p.tags.length ? (" [" + p.tags.join(", ") + "]") : "";
            const ended = p.endedAt ? (" · ended " + escHtml(String(p.endedAt))) : "";
            const last = p.lastOutput ? ('<div class="procSub">↳ ' + escHtml(String(p.lastOutput).slice(0, 120)) + "</div>") : "";
            return '<div class="procCard' + (selected ? ' selected' : '') + '">' +
              '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap">' +
                '<div style="min-width:220px;flex:1">' +
                  '<div class="procTitle">' + escHtml(p.label || "(unnamed)") + ' <span class="procSub">(' + escHtml(p.status) + ')</span></div>' +
                  '<div class="procSub">' + escHtml(p.command || "") + tags + '</div>' +
                  '<div class="procSub">cwd: ' + escHtml(p.cwd || "") + ' · started ' + escHtml(String(p.startedAt || "")) + ended + '</div>' +
                  last +
                "</div>" +
                '<div style="display:flex;gap:6px;align-items:center">' +
                  '<button type="button" class="reconnect" onclick="viewManagedProcessLog(&quot;' + escHtml(p.id) + '&quot;)">Logs</button>' +
                  (running ? ('<button type="button" class="reconnect" onclick="stopManagedProcess(&quot;' + escHtml(p.id) + '&quot;)">Stop</button>') : "") +
                "</div>" +
              "</div>" +
            "</div>";
          }).join("");
        } catch (err) {
          list.textContent = "Failed to load managed processes: " + ((err && err.message) ? err.message : String(err));
        }
      }
      async function startManagedProcess(){
        const cmdEl = document.getElementById("procCommandInput");
        const labelEl = document.getElementById("procLabelInput");
        const tagsEl = document.getElementById("procTagsInput");
        const hint = document.getElementById("procHint");
        const btn = document.getElementById("btnProcStart");
        const command = (cmdEl && cmdEl.value || "").trim();
        if(!command){
          if(hint){ hint.textContent = "Enter a command first (example: npm run dev)."; }
          return;
        }
        if(btn){ btn.disabled = true; }
        try {
          const tags = String(tagsEl && tagsEl.value || "")
            .split(",")
            .map((x)=>x.trim())
            .filter(Boolean);
          const payload = {
            command: command,
            label: String(labelEl && labelEl.value || "").trim(),
            tags: tags,
          };
          const data = await fetch(withToken("/api/processes/start"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }).then((r)=>r.json());
          if(!data || data.ok === false){
            if(hint){ hint.textContent = "Start failed: " + ((data && data.error) || "unknown error"); }
            return;
          }
          if(hint){ hint.textContent = "Started: " + (data.process && data.process.label ? data.process.label : command); }
          if(labelEl){ labelEl.value = ""; }
          if(tagsEl){ tagsEl.value = ""; }
          selectedManagedProcessId = data.process && data.process.id ? data.process.id : null;
          await refreshManagedProcesses();
          if(selectedManagedProcessId){
            await refreshManagedProcessLog(selectedManagedProcessId);
          }
        } catch (err) {
          if(hint){ hint.textContent = "Start failed: " + ((err && err.message) ? err.message : String(err)); }
        } finally {
          if(btn){ btn.disabled = false; }
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
      document.getElementById("pane2TabPlans")?.addEventListener("click",()=>setPane2Tab("plans"));
      document.getElementById("pane2TabProcesses")?.addEventListener("click",()=>setPane2Tab("processes"));
      document.getElementById("btnProcStart")?.addEventListener("click",()=>{ void startManagedProcess(); });
      document.getElementById("btnProcRefresh")?.addEventListener("click",()=>{ void refreshManagedProcesses(); });
      document.getElementById("btnPlanCreate")?.addEventListener("click",()=>{ void createPlan(); });
      document.getElementById("btnPlanRefresh")?.addEventListener("click",()=>{ void refreshPlans(true); });
      document.getElementById("btnPlanRename")?.addEventListener("click",()=>{ void renamePlanTitle(); });
      document.getElementById("btnPlanOpenAgent")?.addEventListener("click",()=>{ openAgentWithSelectedPlan(); });
      document.getElementById("btnPlanNormalize")?.addEventListener("click",()=>{ void normalizeSelectedPlan(); });
      document.getElementById("btnPlanGraphView")?.addEventListener("click",()=>{ setPlanGraphVisibility(!planGraphVisible); });
      document.getElementById("btnPlanGraphRebuild")?.addEventListener("click",()=>{ void rebuildPlanGraph(); });
      document.getElementById("btnPlanGraphZoomIn")?.addEventListener("click",()=>{ zoomPlanGraph(1.2); });
      document.getElementById("btnPlanGraphZoomOut")?.addEventListener("click",()=>{ zoomPlanGraph(0.84); });
      document.getElementById("btnPlanGraphLeft")?.addEventListener("click",()=>{ panPlanGraph(-80, 0); });
      document.getElementById("btnPlanGraphRight")?.addEventListener("click",()=>{ panPlanGraph(80, 0); });
      document.getElementById("btnPlanGraphUp")?.addEventListener("click",()=>{ panPlanGraph(0, -60); });
      document.getElementById("btnPlanGraphDown")?.addEventListener("click",()=>{ panPlanGraph(0, 60); });
      document.getElementById("btnPlanGraphReset")?.addEventListener("click",()=>{
        planGraphViewBox = { x: 0, y: 0, w: planGraphViewBox.baseW, h: planGraphViewBox.baseH, baseW: planGraphViewBox.baseW, baseH: planGraphViewBox.baseH };
        applyPlanGraphViewBox();
      });
      document.getElementById("btnPlanGraphFullscreen")?.addEventListener("click",()=>{ void togglePlanGraphFullscreen(); });
      function applyPlanGraphModeUi(){
        const btn = document.getElementById("btnPlanGraphMode");
        const hint = document.getElementById("planGraphHint");
        if(btn){ btn.textContent = planGraphMode === "tree" ? "Mode: Tree" : "Mode: Timeline"; }
        if(hint){
          hint.textContent = planGraphMode === "tree"
            ? "Tree view: parents centered on children; tightly packed subtrees with sidequest priority shading."
            : "Timeline view (ordered top-to-bottom) with branch lanes and latest-worked highlight.";
        }
      }
      applyPlanGraphModeUi();
      document.getElementById("btnPlanGraphMode")?.addEventListener("click",()=>{
        planGraphMode = planGraphMode === "tree" ? "timeline" : "tree";
        try { localStorage.setItem("winnow.planGraphMode", planGraphMode); } catch {}
        applyPlanGraphModeUi();
        if(selectedPlanMarkdown){ renderPlanGraph(selectedPlanMarkdown); }
      });

      let planGithubTasks = [];
      function escHtml(s){
        return String(s == null ? "" : s)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      }
      function renderPlanGithubTasks(){
        const list = document.getElementById("planGithubTaskList");
        if(!list){ return; }
        if(!Array.isArray(planGithubTasks) || planGithubTasks.length === 0){
          list.innerHTML = '<span class="muted">No tasks parsed from this plan.</span>';
          return;
        }
        const rows = planGithubTasks.map((t)=>{
          const checked = t.selected ? "checked" : "";
          const issueRef = t.mapping && t.mapping.issueRef ? t.mapping.issueRef : "";
          const issueUrl = t.mapping && t.mapping.issueUrl ? t.mapping.issueUrl : "";
          const issueState = t.mapping && t.mapping.issueState ? t.mapping.issueState : "";
          const stateBadge = issueState
            ? '<span class="chip" style="margin-left:6px;">' + escHtml(issueState) + '</span>'
            : '';
          const refLink = issueUrl
            ? '<a href="' + escHtml(issueUrl) + '" target="_blank" rel="noopener">' + escHtml(issueRef || issueUrl) + '</a>'
            : escHtml(issueRef);
          const optional = t.optional ? ' <span class="chip" style="background:rgba(250,204,21,0.15);">sidequest</span>' : '';
          const done = t.done ? '✓' : '○';
          return (
            '<div class="planGhRow" data-key="' + escHtml(t.key) + '">' +
              '<input type="checkbox" class="planGhCheck" ' + checked + ' />' +
              '<span class="planGhDone">' + done + '</span>' +
              '<span class="planGhLabel" title="' + escHtml(t.label) + '">' + escHtml(t.label) + optional + '</span>' +
              '<input type="text" class="procInput procMeta planGhRef" placeholder="owner/repo#123" value="' + escHtml(issueRef) + '" style="width:160px;" />' +
              '<input type="text" class="procInput procMeta planGhUrl" placeholder="https://github.com/..." value="' + escHtml(issueUrl) + '" style="width:220px;" />' +
              '<span class="planGhStateView">' + stateBadge + (refLink ? ' <span class="muted" style="font-size:11px;">' + refLink + '</span>' : '') + '</span>' +
              '<button type="button" class="reconnect planGhSave">Save</button>' +
            '</div>'
          );
        }).join("");
        list.innerHTML = rows;
        list.querySelectorAll(".planGhRow").forEach((row)=>{
          row.querySelector(".planGhCheck")?.addEventListener("change",(evt)=>{
            const k = row.getAttribute("data-key") || "";
            const t = planGithubTasks.find((x)=>x.key === k);
            if(t){ t.selected = Boolean(evt.target && evt.target.checked); }
          });
          row.querySelector(".planGhSave")?.addEventListener("click", async ()=>{
            const k = row.getAttribute("data-key") || "";
            const ref = (row.querySelector(".planGhRef")?.value || "").trim();
            const u = (row.querySelector(".planGhUrl")?.value || "").trim();
            if(!selectedPlanId){ return; }
            try {
              const r = await fetch("/api/plans/" + encodeURIComponent(selectedPlanId) + "/tasks/" + encodeURIComponent(k) + "/github", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ issueRef: ref || null, issueUrl: u || null }),
              });
              const j = await r.json();
              if(j && j.ok){
                const status = document.getElementById("planGithubStatus");
                if(status){ status.textContent = "Saved mapping for " + k; }
                await loadPlanGithubTasks();
              } else {
                const status = document.getElementById("planGithubStatus");
                if(status){ status.textContent = "Save failed: " + (j && j.error || "unknown"); }
              }
            } catch (err) {
              const status = document.getElementById("planGithubStatus");
              if(status){ status.textContent = "Save failed: " + (err && err.message || err); }
            }
          });
        });
      }
      async function loadPlanGithubTasks(){
        if(!selectedPlanId){ planGithubTasks = []; renderPlanGithubTasks(); return; }
        try {
          const r = await fetch("/api/plans/" + encodeURIComponent(selectedPlanId) + "/tasks");
          const j = await r.json();
          if(j && j.ok && Array.isArray(j.tasks)){
            const prevSelected = new Set(planGithubTasks.filter((t)=>t.selected).map((t)=>t.key));
            planGithubTasks = j.tasks.map((t)=>({ ...t, selected: prevSelected.has(t.key) }));
            renderPlanGithubTasks();
          }
        } catch {}
      }
      function setPlanGithubPanelVisible(visible){
        const pane = document.getElementById("planGithubPanel");
        const btn = document.getElementById("btnPlanGithubPanel");
        if(!pane){ return; }
        pane.classList.toggle("isHidden", !visible);
        if(btn){
          btn.classList.toggle("planGhOpen", visible);
          btn.textContent = visible ? "GitHub mapping open" : "GitHub mapping";
          btn.setAttribute("aria-expanded", visible ? "true" : "false");
        }
        if(visible){ void loadPlanGithubTasks(); }
      }
      document.getElementById("btnPlanGithubPanel")?.addEventListener("click",()=>{
        const pane = document.getElementById("planGithubPanel");
        const visible = pane ? pane.classList.contains("isHidden") : true;
        setPlanGithubPanelVisible(visible);
      });
      document.getElementById("btnPlanGithubClose")?.addEventListener("click",()=>{
        setPlanGithubPanelVisible(false);
      });
      async function runPlanGithubSync(dryRun){
        if(!selectedPlanId){ return; }
        const status = document.getElementById("planGithubStatus");
        const repo = (document.getElementById("planGithubRepo")?.value || "").trim();
        const taskKeys = planGithubTasks.filter((t)=>t.selected).map((t)=>t.key);
        if(status){ status.textContent = (dryRun ? "Dry-run sync…" : "Syncing…") + " (" + (taskKeys.length || "all") + " tasks)"; }
        try {
          const r = await fetch("/api/plans/" + encodeURIComponent(selectedPlanId) + "/github/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskKeys, repo: repo || undefined, dryRun: Boolean(dryRun) }),
          });
          const j = await r.json();
          if(j && j.ok){
            const summary = (j.results || []).reduce((acc,x)=>{ acc[x.action] = (acc[x.action]||0)+1; return acc; }, {});
            if(status){
              status.textContent = (dryRun ? "Dry-run: " : "Synced: ") +
                Object.entries(summary).map(([k,v])=>k+"="+v).join(", ");
            }
            await loadPlanGithubTasks();
          } else {
            if(status){ status.textContent = "Sync failed: " + (j && j.error || "unknown"); }
          }
        } catch (err) {
          if(status){ status.textContent = "Sync failed: " + (err && err.message || err); }
        }
      }
      document.getElementById("btnPlanGithubSyncSelected")?.addEventListener("click",()=>{ void runPlanGithubSync(false); });
      document.getElementById("btnPlanGithubDryRun")?.addEventListener("click",()=>{ void runPlanGithubSync(true); });
      async function runPlanReconcile(fix){
        if(!selectedPlanId){ return; }
        const panel = document.getElementById("planReconcilePanel");
        try {
          const r = await fetch("/api/plans/" + encodeURIComponent(selectedPlanId) + "/reconcile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fix: Boolean(fix) }),
          });
          const j = await r.json();
          if(!panel){ return; }
          openPlanReconcileModal();
          if(j && j.ok){
            const conflicts = Array.isArray(j.conflicts) ? j.conflicts : [];
            if(conflicts.length === 0){
              panel.innerHTML = '<span style="color:#86efac;">Reconcile clean — no conflicts between markdown structure and stored mappings.</span>';
              return;
            }
            const fixed = Array.isArray(j.fixed) ? j.fixed : [];
            const items = conflicts.map((c)=>{
              const wasFixed = fixed.some((f)=>f.taskKey===c.taskKey && f.kind===c.kind);
              const tag = wasFixed ? '<span class="chip" style="background:rgba(74,222,128,0.18);">fixed</span> ' : '';
              return '<li>' + tag + '<strong>' + escHtml(c.kind) + '</strong>' + (c.taskKey ? ' <code>' + escHtml(c.taskKey) + '</code>' : '') + ' — ' + escHtml(c.detail) + '</li>';
            }).join("");
            const fixBtn = fix ? '' : ' <button type="button" class="reconnect" id="btnPlanReconcileFix">Apply fixes</button>';
            panel.innerHTML = '<div style="margin-bottom:6px;color:#fde68a;">' +
              conflicts.length + ' conflict' + (conflicts.length===1?'':'s') + ' found.' + fixBtn + '</div>' +
              '<ul style="margin:0;padding-left:18px;">' + items + '</ul>';
            document.getElementById("btnPlanReconcileFix")?.addEventListener("click",()=>{ void runPlanReconcile(true); });
          } else {
            panel.innerHTML = '<span style="color:#fca5a5;">Reconcile failed: ' + escHtml(j && j.error || "unknown") + '</span>';
          }
        } catch (err) {
          if(panel){
            openPlanReconcileModal();
            panel.innerHTML = '<span style="color:#fca5a5;">Reconcile failed: ' + escHtml(err && err.message || String(err)) + '</span>';
          }
        }
      }
      document.getElementById("btnPlanReconcile")?.addEventListener("click",()=>{ void runPlanReconcile(false); });
      document.getElementById("btnPlanReconcileClose")?.addEventListener("click",()=>{ closePlanReconcileModal(); });
      document.getElementById("planReconcileModal")?.addEventListener("click",(evt)=>{
        if(evt.target && evt.target.id === "planReconcileModal"){ closePlanReconcileModal(); }
      });
      document.addEventListener("keydown",(evt)=>{
        if(evt.key === "Escape"){
          const modal = document.getElementById("planReconcileModal");
          if(modal && !modal.classList.contains("isHidden")){ closePlanReconcileModal(); }
        }
      });
      document.getElementById("btnPlanMdFullscreen")?.addEventListener("click",()=>{ void togglePlanMdFullscreen(); });
      document.addEventListener("fullscreenchange", ()=>{ updatePlanGraphFullscreenButton(); updatePlanMdFullscreenButton(); });
      document.getElementById("procFilterInput")?.addEventListener("input",()=>{ void refreshManagedProcesses(); });
      document.getElementById("procStatusFilter")?.addEventListener("change",()=>{ void refreshManagedProcesses(); });
      document.getElementById("procCommandInput")?.addEventListener("keydown",(evt)=>{
        if((evt.metaKey || evt.ctrlKey) && evt.key === "Enter"){
          evt.preventDefault();
          void startManagedProcess();
        }
      });
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
      setPlanGraphVisibility(true);
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
