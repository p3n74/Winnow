import { describe, expect, it } from "vitest";
import { buildAgentWindowPageHtml } from "../src/cli/agentWindowHtml.js";
import {
  laneFromHistoryMessage,
  laneFromTimelineKind,
  shouldReplaceUserText,
  shouldSkipDuplicateUser,
} from "../src/cli/conversationPanel.js";

describe("conversation lanes", () => {
  it("keeps user timeline events on the user lane", () => {
    expect(laneFromTimelineKind("user")).toBe("user");
    expect(laneFromTimelineKind("assistant")).toBe("assistant");
    expect(laneFromTimelineKind("status")).toBe("trace");
  });

  it("reads history kind or role and does not default unknowns to assistant", () => {
    expect(laneFromHistoryMessage({ kind: "user", role: "assistant" })).toBe("user");
    expect(laneFromHistoryMessage({ role: "user" })).toBe("user");
    expect(laneFromHistoryMessage({ role: "entry" })).toBe("skip");
    expect(laneFromHistoryMessage({ role: "tool" })).toBe("trace");
  });

  it("dedupes the optimistic user bubble against the streamed copy", () => {
    expect(shouldSkipDuplicateUser("user", "hello", "hello")).toBe(true);
    expect(shouldReplaceUserText("user", "hello", "hello\n\n[image]")).toBe(true);
    expect(shouldSkipDuplicateUser("user", "hello", "hello\n\n[image]")).toBe(true);
    expect(shouldSkipDuplicateUser("assistant", "hello", "hello")).toBe(false);
  });
});

describe("agent conversation HTML contract", () => {
  it("paints the user prompt locally and does not reload history over a live run", () => {
    const html = buildAgentWindowPageHtml(undefined);
    expect(html).toContain('appendChat("user", prompt)');
    expect(html).toContain("shouldSkipDuplicateUser");
    expect(html).toContain("agentSessionRunning");
    expect(html).toContain("backfillConversationEvents");
    expect(html).toContain('data-role="user"');
  });
});
