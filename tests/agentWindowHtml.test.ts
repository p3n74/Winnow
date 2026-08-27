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
  });
});
