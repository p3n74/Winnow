import { WinnowConfig } from "../config/schema.js";
import {
  parseGlossary,
  protectTechnicalBlocks,
  restoreTechnicalBlocks,
  Translator,
} from "./common.js";
import { deepseekChatCompletionCandidates } from "./deepseekChat.js";
import { fetchJsonWithRetry } from "./http.js";

type DeepSeekRequest = {
  model: string;
  temperature: number;
  messages: Array<{ role: "system" | "user"; content: string }>;
};

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

function buildInputPrompt(text: string): string {
  return [
    "Translate Chinese user instructions to concise, technical English for a coding agent.",
    "Preserve commands, file paths, code blocks, stack traces, and JSON exactly.",
    "Do not alter code identifiers unless explicitly requested in the source text.",
    "Do not alter any __WINNOW_KEEP_*__ placeholder tokens.",
    "Output only the translated prompt.",
    "",
    text,
  ].join("\n");
}

function buildOutputPrompt(text: string, dualOutput: boolean, glossaryHints: string[]): string {
  const rules = [
    "Translate assistant output into Simplified Chinese for engineering usage.",
    "Preserve commands, file paths, code blocks, stack traces, and JSON exactly.",
    "Do not translate code identifiers or flags.",
    "Do not alter any __WINNOW_KEEP_*__ placeholder tokens.",
  ];

  rules.push(dualOutput ? "Return two sections: [原文] then [中文翻译]." : "Return only Chinese translation.");

  if (glossaryHints.length > 0) {
    rules.push(`Glossary preferences: ${glossaryHints.join("; ")}`);
  }

  return [...rules, "", text].join("\n");
}

export class DeepSeekTranslator implements Translator {
  constructor(private readonly config: WinnowConfig) {}

  async translateInput(text: string): Promise<string> {
    if (this.config.inputMode === "off") {
      return text;
    }
    const protectedInput = protectTechnicalBlocks(text);
    const translated = await this.translate(buildInputPrompt(protectedInput.text));
    return restoreTechnicalBlocks(translated, protectedInput.placeholders);
  }

  async translateOutput(text: string): Promise<string> {
    if (this.config.outputMode === "off") {
      return text;
    }
    const protectedOutput = protectTechnicalBlocks(text);
    const translated = await this.translate(
      buildOutputPrompt(
        protectedOutput.text,
        this.config.dualOutput,
        parseGlossary(this.config.translationGlossary),
      ),
    );
    return restoreTechnicalBlocks(translated, protectedOutput.placeholders);
  }

  private async translate(prompt: string): Promise<string> {
    if (!this.config.deepseekApiKey) {
      throw new Error("DeepSeek API key missing");
    }

    const payload: DeepSeekRequest = {
      model: this.config.deepseekModel,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    };

    const init: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.deepseekApiKey}`,
      },
      body: JSON.stringify(payload),
    };

    const urls = deepseekChatCompletionCandidates(this.config.deepseekBaseUrl);
    let lastErr: Error | undefined;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        const body = await fetchJsonWithRetry<DeepSeekResponse>(url, init, {
          timeoutMs: this.config.translatorTimeoutMs,
          retries: this.config.translatorRetries,
        });
        const translated = body.choices?.[0]?.message?.content?.trim();
        if (!translated) {
          throw new Error("DeepSeek translation returned empty content");
        }
        return translated;
      } catch (e) {
        lastErr = e as Error;
        const is404 = lastErr.message.includes("HTTP 404");
        if (is404 && i < urls.length - 1) {
          continue;
        }
        throw lastErr;
      }
    }

    throw lastErr ?? new Error("DeepSeek request failed");
  }
}
