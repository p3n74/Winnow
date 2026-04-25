import { z } from "zod";

const envBool = z.preprocess((value) => {
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true" || lowered === "1" || lowered === "yes") {
      return true;
    }
    if (lowered === "false" || lowered === "0" || lowered === "no") {
      return false;
    }
  }
  return value;
}, z.boolean());

export const configSchema = z.object({
  translatorBackend: z.enum(["ollama", "deepseek_api"]).default("ollama"),
  translatorTimeoutMs: z.coerce.number().int().positive().default(20000),
  translatorRetries: z.coerce.number().int().min(0).default(2),
  ollamaBaseUrl: z.string().url().default("http://127.0.0.1:11434"),
  ollamaTranslationModel: z.string().default("deepseek-v3"),
  deepseekBaseUrl: z.string().url().default("https://api.deepseek.com"),
  deepseekApiKey: z.string().default(""),
  deepseekModel: z.string().default("deepseek-v4-flash"),
  translationGlossary: z.string().default(""),
  inputMode: z.enum(["off", "zh_to_en"]).default("off"),
  outputMode: z.enum(["off", "en_to_zh"]).default("off"),
  profile: z.enum(["learning_zh", "engineering_exact"]).default("engineering_exact"),
  showOriginal: z.boolean().default(false),
  dualOutput: z.boolean().default(false),
  cursorCommand: z.string().default("cursor-agent"),
  logsEnabled: envBool.default(true),
  logsDir: z.string().default(".winnow/logs"),
  sessionId: z.string().optional(),
  /** Absolute path: companion UI / agent working directory (persisted in project profile). */
  uiWorkspaceDir: z.string().optional(),
});

export type WinnowConfig = z.infer<typeof configSchema>;

export function loadConfigFromEnv(): WinnowConfig {
  return configSchema.parse({
    translatorBackend: process.env.WINNOW_TRANSLATOR_BACKEND,
    translatorTimeoutMs: process.env.WINNOW_TRANSLATOR_TIMEOUT_MS,
    translatorRetries: process.env.WINNOW_TRANSLATOR_RETRIES,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    ollamaTranslationModel: process.env.OLLAMA_TRANSLATION_MODEL,
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    deepseekModel: process.env.DEEPSEEK_MODEL,
    translationGlossary: process.env.WINNOW_TRANSLATION_GLOSSARY,
    inputMode: process.env.WINNOW_INPUT_MODE,
    outputMode: process.env.WINNOW_OUTPUT_MODE,
    profile: process.env.WINNOW_PROFILE,
    logsEnabled: process.env.WINNOW_LOGS_ENABLED,
    logsDir: process.env.WINNOW_LOGS_DIR,
  });
}
