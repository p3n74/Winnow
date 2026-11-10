import { describe, expect, it } from "vitest";
import { getEffectiveArgs } from "../src/pipeline/session.js";
import type { WinnowConfig } from "../src/config/schema.js";

const baseConfig: WinnowConfig = {
  translatorBackend: "ollama",
  translatorTimeoutMs: 20000,
  translatorRetries: 2,
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaTranslationModel: "deepseek-v3",
  deepseekBaseUrl: "https://api.deepseek.com",
  deepseekApiKey: "",
  deepseekModel: "deepseek-v4-flash",
  translationGlossary: "",
  inputMode: "off",
  outputMode: "off",
  profile: "engineering_exact",
  showOriginal: false,
  dualOutput: false,
  cursorCommand: "cursor-agent",
  logsEnabled: true,
  logsDir: ".winnow/logs",
};

describe("getEffectiveArgs", () => {
  it("does not add trust/approve-mcps for interactive passthrough without --print", () => {
    expect(getEffectiveArgs(baseConfig, ["chat"], false)).toEqual(["chat"]);
  });

  it("adds --trust and --approve-mcps when --print is present", () => {
    expect(getEffectiveArgs(baseConfig, ["--print", "hi"], false)).toEqual([
      "--print",
      "hi",
      "--trust",
      "--approve-mcps",
    ]);
  });

  it("adds print + headless MCP flags for interactive loop sessions", () => {
    expect(getEffectiveArgs(baseConfig, [], true)).toEqual([
      "--print",
      "--trust",
      "--approve-mcps",
    ]);
  });
});
