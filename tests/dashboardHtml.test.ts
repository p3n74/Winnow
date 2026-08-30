import { describe, expect, it } from "vitest";
import { buildDashboardPageHtml } from "../src/cli/ui/dashboardHtml.js";

function sliceBetween(html: string, startMarker: string, endMarker: string): string {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe("buildDashboardPageHtml", () => {
  it("shares apiJson and only 1Hz-polls the agent after SSE onerror", () => {
    const html = buildDashboardPageHtml(undefined);
    expect(html).toContain("async function apiJson");
    expect(html).toContain("function withToken");
    expect(html).toContain("streamSource.onerror");

    const startFn = sliceBetween(html, "async function startAgentRun", "function appendPrompt");
    expect(startFn).toContain("attachStream");
    expect(startFn).toContain("pollAgent()");
    expect(startFn).not.toMatch(/setInterval\s*\(\s*pollAgent/);

    const attachFn = sliceBetween(html, "function attachStream", "function clearAgentFlavorTimer");
    expect(attachFn).toMatch(/streamSource\.onerror[\s\S]{0,250}setInterval\s*\(\s*pollAgent\s*,\s*1000\s*\)/);

    const intervalHits = [...html.matchAll(/setInterval\s*\(\s*pollAgent\s*,\s*1000\s*\)/g)];
    expect(intervalHits.length).toBe(1);
    const around = html.slice(Math.max(0, intervalHits[0].index! - 180), intervalHits[0].index! + 40);
    expect(around).toContain("streamSource.onerror");
  });

  it("sends planId / executionMode and applies live subagents", () => {
    const html = buildDashboardPageHtml(undefined);
    expect(html).toContain("planId");
    expect(html).toContain("winnow-active-plan-id");
    expect(html).toContain("applyLiveSubagents");
    expect(html).toContain("executionMode");
    expect(html).toContain("attachmentIds");
    expect(html).toContain('id="agentSubagentsPanel"');
    expect(html).toContain("s.liveSubagents");
    expect(html).toMatch(/id="agentSubagentsPanel"[^>]*hidden/);
  });

  it("loads GitHub inbox from /api/plans/inbox instead of per-plan /tasks", () => {
    const html = buildDashboardPageHtml(undefined);
    const fn = sliceBetween(html, "async function refreshGithubNotifications()", "async function refreshDiskDashboard");
    expect(fn).toContain("apiJson('/api/plans/inbox')");
    expect(fn).not.toContain("/tasks");
    expect(fn).toContain("inboxData.inbox");
  });

  it("force-refreshes disk sizes only from the Refresh button", () => {
    const html = buildDashboardPageHtml(undefined);
    expect(html).toContain('onclick="refreshDiskDashboard(true)"');
    const fn = sliceBetween(html, "async function refreshDiskDashboard", "async function refreshProjects");
    expect(fn).toContain("force ? '?refresh=1'");
    expect(html).toContain("void refreshDiskDashboard()");
  });

  it("exposes token pricing controls on the settings view", () => {
    const html = buildDashboardPageHtml(undefined);
    expect(html).toContain('id="pricingInputPerMillion"');
    expect(html).toContain('id="pricingOutputPerMillion"');
    expect(html).toContain("USD / million");
    expect(html).toContain("async function refreshPricingEditor");
    expect(html).toContain("async function savePricingFromForm");
    expect(html).toContain("withToken('/api/pricing')");
    expect(html).toContain("void refreshPricingEditor()");
    expect(html).toContain("Set default input/output USD per million tokens in Settings.");
  });

  it("skips 3s /api/state and /api/logs polling on agent and settings views", () => {
    const html = buildDashboardPageHtml(undefined);
    expect(html).toContain("currentDashboardView");
    expect(html).toContain("currentDashboardView !== 'agent'");
    expect(html).toContain("currentDashboardView !== 'settings'");
    expect(html).toContain("setInterval(refresh, 3000)");
    expect(html).toContain("setInterval(refreshMetrics, 1000)");
    const refreshFn = sliceBetween(html, "async function refresh()", "async function refreshWorkspaceCwd");
    expect(refreshFn).toContain("apiJson('/api/state')");
    expect(refreshFn).toContain("apiJson('/api/logs?limit=60')");
  });

  it("shows a centered running-agent count in the topbar", () => {
    const html = buildDashboardPageHtml(undefined);
    expect(html).toContain('id="toolbarAgentCount"');
    expect(html).toContain("pollToolbarAgentCount");
    expect(html).toContain("/api/agent/running");
    expect(html).toContain("1 agent running");
    expect(html).toContain("Agents keep working after you change the working directory.");
  });

  it("adds a Cursor mode picker, slash palette, and custom mode badge to the Agent Workspace", () => {
    const html = buildDashboardPageHtml(undefined);
    expect(html).toContain('id="agentCursorMode"');
    expect(html).toContain('id="agentSlashPalette"');
    expect(html).toContain('id="agentSlashPaletteList"');
    expect(html).toContain('id="agentCustomModeBadge"');
    expect(html).toContain('id="agentCustomModeName"');
    expect(html).toContain('id="agentCustomModeClear"');
    expect(html).toContain('id="agentPrompt"');
    expect(html).toContain("/api/agent/slash-catalog");
    expect(html).toContain("winnow.agentCursorMode");
    expect(html).toContain("winnow.agentCustomModeSkill");
    expect(html).toContain("setCursorMode(item.name || item.id)");
  });

  it("sends cursorMode, slashInvocations, and customModeSkill from startAgentRun", () => {
    const html = buildDashboardPageHtml(undefined);
    const startFn = sliceBetween(html, "async function startAgentRun", "function appendPrompt");
    expect(startFn).toContain("cursorMode:");
    expect(startFn).toContain("slashInvocations");
    expect(startFn).toContain("customModeSkill");
    expect(startFn).toContain("pendingSlashInvocations");
    // existing controls must still be respected
    expect(startFn).toContain("attachStream");
    expect(startFn).toContain("pollAgent()");
  });

  it("cycles Cursor mode with Shift+Tab and keeps Ctrl/Cmd+Enter running", () => {
    const html = buildDashboardPageHtml(undefined);
    const keydownIdx = html.indexOf("document.getElementById('agentPrompt').addEventListener('keydown'");
    expect(keydownIdx).toBeGreaterThan(-1);
    const keydownFn = html.slice(keydownIdx, html.indexOf("addEventListener('input'", keydownIdx));
    expect(keydownFn).toContain("startAgentRun();");
    expect(keydownFn).toContain("cycleCursorMode");
    expect(keydownFn).toContain("evt.shiftKey");
  });
});
