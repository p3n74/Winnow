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

  it("exposes a companion Web tab that previews host-machine localhost URLs", () => {
    const html = buildMainTerminalHtml("secret");
    expect(html).toContain('data-pane2-tab="web"');
    expect(html).toContain('id="pane2Web"');
    expect(html).toContain('id="webFrame"');
    expect(html).toContain('id="webUrl"');
    expect(html).toContain("/__preview/");
    expect(html).toContain("stripWinnowTokenSearch");
    expect(html).not.toContain('withToken("/__preview/');
    expect(html).not.toContain("pageIsLoopback");
    expect(html).toContain("/api/preview/probe");
    expect(html).toContain("data-web-port=\"3001\"");
    expect(html).toContain('id="webChromeView"');
    expect(html).toContain("/ws/preview/chrome");
    expect(html).toContain("/api/preview/chrome");
    expect(html).toContain("data-web-port=\"8081\"");
    expect(html).toContain('id="webFullscreen"');
    expect(html).toContain("toggleWebFullscreen");
    expect(html).toContain("fitWebCanvas");
    expect(html).toContain("id=\"webStage\"");
    expect(html).toContain("ensureWebPreviewLoaded");
    expect(html).toContain("2 agent · web · shell");
    expect(html).toContain('new RegExp("^/__preview/');
    expect(html).not.toContain("/^/__preview/");
    expect(html).not.toContain(".replace(/^?/");
    expect(html).toContain('raw.charAt(0) === "?"');
  });

  it("keeps the inline grid script syntactically valid", () => {
    const html = buildMainTerminalHtml("secret");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    expect(scripts.length).toBeGreaterThan(0);
    const pageScript = scripts[scripts.length - 1] ?? "";
    expect(pageScript).toContain("openPane");
    expect(() => new Function(pageScript)).not.toThrow();
  });
});
