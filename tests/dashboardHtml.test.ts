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
});
