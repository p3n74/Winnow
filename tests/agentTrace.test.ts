import { describe, expect, it } from "vitest";
import { pickActiveAgentSession } from "../src/cli/ui/agentTrace.js";
import { buildMainTerminalHtml } from "../src/cli/ui/mainGridHtml.js";
import { buildAgentWindowPageHtml } from "../src/cli/agentWindowHtml.js";

type Session = {
  id: string;
  status: string;
  startedAt: string;
  endedAt?: string;
};

describe("pickActiveAgentSession", () => {
  it("returns null for an empty list", () => {
    expect(pickActiveAgentSession([])).toBeNull();
  });

  it("prefers a running session over a later done session", () => {
    const done: Session = {
      id: "done-later",
      status: "done",
      startedAt: "2026-08-27T12:00:00.000Z",
      endedAt: "2026-08-27T12:10:00.000Z",
    };
    const running: Session = {
      id: "running-older",
      status: "running",
      startedAt: "2026-08-27T11:00:00.000Z",
    };
    expect(pickActiveAgentSession([done, running])?.id).toBe("running-older");
  });

  it("picks the latest running session by startedAt", () => {
    const older: Session = {
      id: "run-old",
      status: "running",
      startedAt: "2026-08-27T10:00:00.000Z",
    };
    const newer: Session = {
      id: "run-new",
      status: "running",
      startedAt: "2026-08-27T13:00:00.000Z",
    };
    expect(pickActiveAgentSession([older, newer])?.id).toBe("run-new");
  });

  it("falls back to latest endedAt or startedAt when none are running", () => {
    const early: Session = {
      id: "early",
      status: "done",
      startedAt: "2026-08-27T09:00:00.000Z",
      endedAt: "2026-08-27T09:05:00.000Z",
    };
    const later: Session = {
      id: "later",
      status: "error",
      startedAt: "2026-08-27T08:00:00.000Z",
      endedAt: "2026-08-27T11:00:00.000Z",
    };
    expect(pickActiveAgentSession([early, later])?.id).toBe("later");
  });
});

describe("pane 1 Trace HTML contract", () => {
  it("includes Browser, Trace, and Docs tabs on pane 1", () => {
    const html = buildMainTerminalHtml();
    expect(html).toContain('data-pane1-tab="browser"');
    expect(html).toContain('data-pane1-tab="trace"');
    expect(html).toContain('data-pane1-tab="docs"');
    expect(html).toContain('id="pane1TabDocs"');
    expect(html).toContain('id="pane1Docs"');
    expect(html).toContain('id="docsFileSelect"');
    expect(html).not.toContain('data-pane2-tab="docs"');
    expect(html).not.toContain('id="pane2Docs"');
    expect(html).toContain('id="pane1Trace"');
    expect(html).toContain('id="btnPane1Expand"');
    expect(html).toContain(".left.pane1Expanded");
    expect(html).toContain('id="gridLeftBottom"');
  });

  it("includes a Scripts tab on pane 2", () => {
    const html = buildMainTerminalHtml();
    expect(html).toContain('data-pane2-tab="scripts"');
    expect(html).toContain('data-scripts-step="list"');
    expect(html).toContain('data-scripts-step="detail"');
    expect(html).toContain('id="btnScriptsBack"');
    expect(html).toContain('id="scriptKnobs"');
    expect(html).toContain('id="scriptSampleCommand"');
    expect(html).toContain("Adjustable parameters");
    expect(html).toContain("Current knob values:\\n");
    expect(html).not.toMatch(/Current knob values:\n/);
  });

  it("posts the active session id to the parent from the agent window", () => {
    const html = buildAgentWindowPageHtml(undefined);
    expect(html).toContain("winnow-agent-session");
  });
});
