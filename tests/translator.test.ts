import { describe, expect, it, vi } from "vitest";
import { OllamaTranslator } from "../src/translator/ollamaTranslator.js";
import { DeepSeekTranslator } from "../src/translator/deepseekTranslator.js";
import { protectTechnicalBlocks, restoreTechnicalBlocks } from "../src/translator/common.js";
import { WinnowConfig } from "../src/config/schema.js";

const config: WinnowConfig = {
  translatorBackend: "ollama",
  translatorTimeoutMs: 20000,
  translatorRetries: 1,
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaTranslationModel: "deepseek-v3",
  deepseekBaseUrl: "https://api.deepseek.com",
  deepseekApiKey: "test-key",
  deepseekModel: "deepseek-v4-flash",
  translationGlossary: "PR:拉取请求",
  inputMode: "zh_to_en",
  outputMode: "en_to_zh",
  profile: "engineering_exact",
  showOriginal: false,
  dualOutput: false,
  cursorCommand: "cursor-agent",
  logsEnabled: true,
  logsDir: ".winnow/logs",
};

describe("OllamaTranslator", () => {
  it("translates through ollama chat api", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: "translated" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const translator = new OllamaTranslator(config);
    const out = await translator.translateOutput("hello");

    expect(out).toBe("translated");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws when ollama returns bad status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "server error",
    });
    vi.stubGlobal("fetch", fetchMock);
    const translator = new OllamaTranslator(config);

    await expect(translator.translateInput("你好")).rejects.toThrow(/HTTP 500/);
  });

  it("protects and restores technical spans", () => {
    const source = "Use `npm run build` in ./src/app.ts with --watch and ```json\n{\"ok\":true}\n```";
    const protectedContent = protectTechnicalBlocks(source);

    expect(protectedContent.text).toContain("__WINNOW_KEEP_");
    const restored = restoreTechnicalBlocks(protectedContent.text, protectedContent.placeholders);
    expect(restored).toBe(source);
  });
});

describe("DeepSeekTranslator", () => {
  it("translates through deepseek chat completions api", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "translated" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const translator = new DeepSeekTranslator({ ...config, translatorBackend: "deepseek_api" });
    const out = await translator.translateOutput("hello");

    expect(out).toBe("translated");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries next URL when first returns 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "not found",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "ok" } }] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const translator = new DeepSeekTranslator({
      ...config,
      translatorBackend: "deepseek_api",
      translatorRetries: 0,
    });
    const out = await translator.translateOutput("hello");

    expect(out).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/chat/completions");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/v1/chat/completions");
  });
});
