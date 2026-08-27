import { describe, expect, it } from "vitest";
import { assistantTextFromStreamEvent, shouldAppendAssistantStreamEvent } from "../src/cursor/streamJson.js";

const delta = {
  type: "assistant",
  timestamp_ms: 1_700_000_000_000,
  message: { content: [{ type: "text", text: "I'll read the thesis. " }] },
};

const preToolFlush = {
  type: "assistant",
  timestamp_ms: 1_700_000_000_100,
  model_call_id: "call_abc",
  message: { content: [{ type: "text", text: "I'll read the thesis. Follow the thesis figure story." }] },
};

const finalFlush = {
  type: "assistant",
  message: { content: [{ type: "text", text: "Follow the thesis figure story." }] },
};

describe("shouldAppendAssistantStreamEvent", () => {
  it("appends streaming deltas with timestamp_ms and no model_call_id", () => {
    expect(shouldAppendAssistantStreamEvent(delta)).toBe(true);
  });

  it("skips the buffered flush before a tool call", () => {
    expect(shouldAppendAssistantStreamEvent(preToolFlush)).toBe(false);
  });

  it("skips the final turn flush that duplicates the full reply", () => {
    expect(shouldAppendAssistantStreamEvent(finalFlush)).toBe(false);
  });

  it("ignores non-assistant events", () => {
    expect(shouldAppendAssistantStreamEvent({ type: "result", result: "done" })).toBe(false);
  });
});

describe("assistantTextFromStreamEvent", () => {
  it("joins content text parts", () => {
    expect(assistantTextFromStreamEvent(delta)).toBe("I'll read the thesis. ");
    expect(
      assistantTextFromStreamEvent({
        type: "assistant",
        message: { content: [{ text: "Follow " }, { text: "the story." }] },
      }),
    ).toBe("Follow the story.");
  });
});
