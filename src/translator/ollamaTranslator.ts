import { WinnowConfig } from "../config/schema.js";

type OllamaChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OllamaChatRequest = {
  model: string;
  stream: boolean;
  messages: OllamaChatMessage[];
};

type OllamaChatResponse = {
  message?: { content?: string };
};

function buildInputPrompt(text: string): string {
  return [
    "Translate Chinese user instructions to concise, technical English for a coding agent.",
    "Preserve commands, file paths, code blocks, stack traces, and JSON exactly.",
    "Do not alter code identifiers unless explicitly requested in the source text.",
    "Output only the translated prompt.",
    "",
    text,
  ].join("\n");
}

function buildOutputPrompt(text: string, dualOutput: boolean): string {
  const rules = [
    "Translate assistant output into Simplified Chinese for engineering usage.",
    "Preserve commands, file paths, code blocks, stack traces, and JSON exactly.",
    "Do not translate code identifiers or flags.",
  ];

  if (dualOutput) {
    rules.push("Return two sections: [原文] then [中文翻译].");
  } else {
    rules.push("Return only Chinese translation.");
  }

  return [...rules, "", text].join("\n");
}

export class OllamaTranslator {
  constructor(private readonly config: WinnowConfig) {}

  async translateInput(text: string): Promise<string> {
    if (this.config.inputMode === "off") {
      return text;
    }

    return this.translate(buildInputPrompt(text));
  }

  async translateOutput(text: string): Promise<string> {
    if (this.config.outputMode === "off") {
      return text;
    }

    return this.translate(buildOutputPrompt(text, this.config.dualOutput));
  }

  private async translate(prompt: string): Promise<string> {
    const payload: OllamaChatRequest = {
      model: this.config.ollamaTranslationModel,
      stream: false,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    };

    const response = await fetch(`${this.config.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Ollama translation failed with status ${response.status}`);
    }

    const body = (await response.json()) as OllamaChatResponse;
    const translated = body.message?.content?.trim();

    if (!translated) {
      throw new Error("Ollama translation returned empty content");
    }

    return translated;
  }
}
