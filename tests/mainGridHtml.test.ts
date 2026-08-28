import { describe, expect, it } from "vitest";
import { buildMainTerminalHtml } from "../src/cli/ui/mainGridHtml.js";

describe("buildMainTerminalHtml", () => {
  it("puts a running-agent count in the middle of the navbar", () => {
    const html = buildMainTerminalHtml(undefined);
    expect(html).toContain('id="toolbarAgentCount"');
    expect(html).toContain("toolbarCenter");
    expect(html).toContain("startToolbarAgentCountPolling");
    expect(html).toContain('apiJson("/api/agent/running")');
    expect(html).toContain("1 agent running");
    expect(html).toContain("Live cursor-agent processes keep working after you change the working directory.");
    const toolbarStart = html.indexOf('<div class="toolbar">');
    const toolbarEnd = html.indexOf('<div class="root">', toolbarStart);
    const toolbar = html.slice(toolbarStart, toolbarEnd);
    expect(toolbar.indexOf("toolbarLeft")).toBeLessThan(toolbar.indexOf("toolbarCenter"));
    expect(toolbar.indexOf("toolbarCenter")).toBeLessThan(toolbar.indexOf("toolbarRight"));
    expect(toolbar.indexOf("toolbarAgentCount")).toBeGreaterThan(toolbar.indexOf("toolbarCenter"));
    expect(toolbar.indexOf("toolbarAgentCount")).toBeLessThan(toolbar.indexOf("toolbarRight"));
  });
});
