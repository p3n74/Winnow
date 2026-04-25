import { z } from "zod";

export const configSchema = z.object({
  ollamaBaseUrl: z.string().url().default("http://127.0.0.1:11434"),
  ollamaTranslationModel: z.string().default("deepseek-v3"),
  inputMode: z.enum(["off", "zh_to_en"]).default("off"),
  outputMode: z.enum(["off", "en_to_zh"]).default("off"),
  profile: z.enum(["learning_zh", "engineering_exact"]).default("engineering_exact"),
  showOriginal: z.boolean().default(false),
  dualOutput: z.boolean().default(false),
  cursorCommand: z.string().default("cursor-agent"),
});

export type WinnowConfig = z.infer<typeof configSchema>;

export function loadConfigFromEnv(): WinnowConfig {
  return configSchema.parse({
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    ollamaTranslationModel: process.env.OLLAMA_TRANSLATION_MODEL,
    inputMode: process.env.WINNOW_INPUT_MODE,
    outputMode: process.env.WINNOW_OUTPUT_MODE,
    profile: process.env.WINNOW_PROFILE,
  });
}
