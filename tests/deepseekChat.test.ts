import { describe, expect, it } from "vitest";
import { deepseekChatCompletionCandidates } from "../src/translator/deepseekChat.js";

describe("deepseekChatCompletionCandidates", () => {
  it("uses native path then v1 fallback for host-only base", () => {
    const u = deepseekChatCompletionCandidates("https://api.deepseek.com");
    expect(u[0]).toBe("https://api.deepseek.com/chat/completions");
    expect(u[1]).toBe("https://api.deepseek.com/v1/chat/completions");
  });

  it("normalizes trailing slash", () => {
    const u = deepseekChatCompletionCandidates("https://api.deepseek.com/");
    expect(u[0]).toBe("https://api.deepseek.com/chat/completions");
  });

  it("extends /v1 base only", () => {
    const u = deepseekChatCompletionCandidates("https://api.deepseek.com/v1");
    expect(u).toEqual(["https://api.deepseek.com/v1/chat/completions"]);
  });

  it("returns full URL as-is when already .../chat/completions", () => {
    const full = "https://api.deepseek.com/chat/completions";
    expect(deepseekChatCompletionCandidates(full)).toEqual([full]);
  });
});
