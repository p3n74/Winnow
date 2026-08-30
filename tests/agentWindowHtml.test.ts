import { describe, expect, it } from "vitest";
import { buildAgentWindowPageHtml } from "../src/cli/agentWindowHtml.js";

describe("buildAgentWindowPageHtml", () => {
  it("collapses Mode–metrics behind a persisted Controls toggle", () => {
    const html = buildAgentWindowPageHtml(undefined);
    expect(html).toContain("winnow.agentControlsCollapsed");
    expect(html).toContain("data-agent-controls");
    expect(html).toContain('id="btnToggleAgentControls"');
    expect(html).toContain('id="agentControls"');
    expect(html).toContain('aria-controls="agentControls"');
    expect(html).toContain('id="agentCollapsedModel"');
    expect(html).toContain('id="agentPrompt"');
    expect(html).toContain("data-agent-run");
    expect(html).toContain('id="agentExecutionMode"');
    expect(html).toContain('id="agentModelPref"');
    expect(html).toContain('id="autonomyMode"');
    expect(html).toContain('id="graphSeedMode"');
    expect(html).toContain('id="continueMode"');
    expect(html).toContain('id="agentArgs"');
    expect(html).toContain('id="agentSessionSelect"');
    expect(html).toContain('id="agentPlanSelect"');
    expect(html).toContain('id="agentCwdInput"');
    expect(html).toContain('id="agentStatusBadge"');
    expect(html).toContain('id="agentSessionInfo"');
    expect(html).toContain('id="agentThinking"');
    expect(html).toContain('id="agentSubagentsPanel"');
    expect(html).toMatch(/id="agentSubagentsPanel"[^>]*hidden/);
    expect(html).toContain(".subagents-panel");
    expect(html).toContain("display: none !important");
  });

  it("continues via stored Cursor UUID instead of injecting Winnow ids into --resume args", () => {
    const html = buildAgentWindowPageHtml(undefined);
    expect(html).toContain("cursorSessionId: continueThis");
    expect(html).toContain("rememberCursorSessionId");
    expect(html).toContain("Continue uses Cursor");
    expect(html).not.toContain("pass <code>--resume");
    expect(html).not.toContain("effectiveArgs");
  });

  it("shares apiJson and only 1Hz-polls the agent after SSE onerror", () => {
    const html = buildAgentWindowPageHtml(undefined);
    expect(html).toContain("async function apiJson");
    expect(html).toContain("function withToken");
    expect(html).toContain("streamSource.onerror");

    const start = html.indexOf("async function startAgentRun");
    const startEnd = html.indexOf("function appendPrompt", start);
    expect(start).toBeGreaterThan(-1);
    expect(startEnd).toBeGreaterThan(start);
    const startFn = html.slice(start, startEnd);
    expect(startFn).toContain("attachStream");
    expect(startFn).toContain("pollAgent()");
    expect(startFn).not.toMatch(/setInterval\s*\(\s*pollAgent/);

    const attach = html.indexOf("function attachStream");
    const attachEnd = html.indexOf("function clearAgentFlavorTimer", attach);
    const attachFn = html.slice(attach, attachEnd);
    expect(attachFn).toMatch(/streamSource\.onerror[\s\S]{0,250}setInterval\s*\(\s*pollAgent\s*,\s*1000\s*\)/);

    const intervalHits = [...html.matchAll(/setInterval\s*\(\s*pollAgent\s*,\s*1000\s*\)/g)];
    expect(intervalHits.length).toBe(1);
    const around = html.slice(Math.max(0, intervalHits[0].index! - 180), intervalHits[0].index! + 40);
    expect(around).toContain("streamSource.onerror");
  });

  it("exposes a collapsible Agents thread list in embed and unlocks other threads while one runs", () => {
    const html = buildAgentWindowPageHtml(undefined);
    expect(html).toContain('id="agentThreadsSidebar"');
    expect(html).toContain('id="btnNewAgent"');
    expect(html).toContain('id="btnToggleThreads"');
    expect(html).toContain("winnow.agentThreadsCollapsed");
    expect(html).toContain("threads-collapsed");
    expect(html).toContain("function selectedIsRunning");
    expect(html).toContain("function composerLocked");
    expect(html).toContain("/api/agent/running");
    expect(html).toContain("/api/agent/overlaps");
    expect(html).toContain('id="agentOverlapBanner"');
    expect(html).toContain('id="btnStartResolver"');
    expect(html).toContain('id="agentSessionSelect"');
    expect(html).toContain('id="btnOpenThreads"');
    expect(html).toContain("width: 0 !important");
    expect(html).not.toContain("<label>Resume</label>");
    expect(html).not.toContain(">New chat<");
    expect(html).not.toMatch(/<aside class="side-bar hide-embed"/);
    expect(html).toContain("New agent thread. Run starts a separate cursor-agent process");
  });

  it("labels threads that keep running in another working directory", () => {
    const html = buildAgentWindowPageHtml(undefined);
    expect(html).toContain("lastSessionsCwd");
    expect(html).toContain("other folder · ");
    expect(html).toContain("data.cwd");
  });

  it("recreates the Cursor mode picker, slash palette, and Custom Mode badge in the composer", () => {
    const html = buildAgentWindowPageHtml(undefined);

    // Cursor mode picker
    expect(html).toContain('id="agentCursorMode"');
    expect(html).toContain('<option value="agent">Agent</option>');
    expect(html).toContain('<option value="ask">Ask</option>');
    expect(html).toContain('<option value="plan">Plan</option>');

    // Slash palette overlay
    expect(html).toContain('id="agentSlashPalette"');
    expect(html).toContain('id="agentSlashPaletteList"');

    // Custom Mode badge
    expect(html).toContain('id="agentCustomModeBadge"');
    expect(html).toContain('id="agentCustomModeName"');
    expect(html).toContain('id="agentCustomModeClear"');

    // localStorage keys
    expect(html).toContain("winnow.agentCursorMode");
    expect(html).toContain("winnow.agentCustomModeSkill");

    // startAgentRun payload fields
    expect(html).toContain("cursorMode:");
    expect(html).toContain("slashInvocations");
    expect(html).toContain("customModeSkill");

    // Slash catalog fetch
    expect(html).toContain("/api/agent/slash-catalog");

    // Relabeled fields
    expect(html).toMatch(/<label>Backend<\/label>/);
    expect(html).toContain("Winnow plan");

    // Existing "Mode" label now refers to Cursor mode, not the backend select
    expect(html).not.toMatch(/<label>Mode<\/label>\s*<select id="agentExecutionMode">/);
  });

  it("keeps agentPrompt keydown handling for Cmd+Enter run, palette navigation, and Shift+Tab cycling", () => {
    const html = buildAgentWindowPageHtml(undefined);
    const start = html.indexOf('document.getElementById("agentPrompt").addEventListener("keydown"');
    expect(start).toBeGreaterThan(-1);
    const end = html.indexOf("});", html.indexOf("cycleCursorMode();", start));
    const keydownFn = html.slice(start, end + 3);
    expect(keydownFn).toContain("startAgentRun();");
    expect(keydownFn).toContain("ArrowDown");
    expect(keydownFn).toContain("ArrowUp");
    expect(keydownFn).toContain("Escape");
    expect(keydownFn).toContain("Backspace");
    expect(keydownFn).toContain("selectSlashPaletteItem(slashHighlightIndex, evt.altKey)");
    expect(keydownFn).toContain('evt.key === "Tab" && evt.shiftKey');
    expect(keydownFn).toContain("cycleCursorMode();");
  });

  it("wires slashInvocations and customModeSkill into the startAgentRun payload and clears invocations after success", () => {
    const html = buildAgentWindowPageHtml(undefined);
    const start = html.indexOf("async function startAgentRun");
    const end = html.indexOf("function appendPrompt", start);
    const startFn = html.slice(start, end);
    expect(startFn).toContain('cursorMode: document.getElementById("agentCursorMode")?.value || "agent"');
    expect(startFn).toContain("slashInvocations: pendingSlashInvocations.slice()");
    expect(startFn).toContain('customModeSkill: (pinnedCustomModeSkill || "").trim() || undefined');
    expect(startFn).toContain("pendingSlashInvocations.length === 0 && !pinnedCustomModeSkill");
    expect(startFn).toContain("pendingSlashInvocations = [];");
  });

  it("applies catalog mode rows by name so mode:ask is not treated as agent", () => {
    const html = buildAgentWindowPageHtml(undefined);
    expect(html).toContain("setCursorMode(item.name || item.id)");
    expect(html).not.toContain("setCursorMode(item.id);");
    expect(html).toContain("catalogHasModes");
  });
});
