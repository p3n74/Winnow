import { describe, expect, it, vi } from "vitest";
import { OllamaTranslator } from "../src/translator/ollamaTranslator.js";
const config = {
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaTranslationModel: "deepseek-v3",
    inputMode: "zh_to_en",
    outputMode: "en_to_zh",
    profile: "engineering_exact",
    showOriginal: false,
    dualOutput: false,
    cursorCommand: "cursor-agent",
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
        });
        vi.stubGlobal("fetch", fetchMock);
        const translator = new OllamaTranslator(config);
        await expect(translator.translateInput("你好")).rejects.toThrow("status 500");
    });
});
//# sourceMappingURL=translator.test.js.map