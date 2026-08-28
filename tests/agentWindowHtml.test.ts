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
    expect(html).toContain("cursorSessionId: continueMode");
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
});
