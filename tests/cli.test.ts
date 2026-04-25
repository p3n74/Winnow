import { describe, expect, it } from "vitest";
import { mergeConfig } from "../src/cli/index.js";
import { WinnowConfig } from "../src/config/schema.js";

const baseConfig: WinnowConfig = {
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaTranslationModel: "deepseek-v3",
  inputMode: "off",
  outputMode: "off",
  profile: "engineering_exact",
  showOriginal: false,
  dualOutput: false,
  cursorCommand: "cursor-agent",
};

describe("mergeConfig", () => {
  it("enables chinese output with --zh", () => {
    const merged = mergeConfig(baseConfig, { zh: true });
    expect(merged.outputMode).toBe("en_to_zh");
  });

  it("applies learning profile defaults", () => {
    const merged = mergeConfig(baseConfig, { profile: "learning_zh" });
    expect(merged.outputMode).toBe("en_to_zh");
    expect(merged.showOriginal).toBe(true);
  });

  it("disables translation with --no-translate", () => {
    const merged = mergeConfig(
      { ...baseConfig, inputMode: "zh_to_en", outputMode: "en_to_zh" },
      { noTranslate: true },
    );
    expect(merged.inputMode).toBe("off");
    expect(merged.outputMode).toBe("off");
  });
});
