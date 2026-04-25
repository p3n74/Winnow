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
  showOriginal: envBool.default(false),
  dualOutput: envBool.default(false),
  /** Blank env values fall back to `cursor-agent` so `spawn` never receives an empty path. */
  cursorCommand: z.preprocess(
    (v) => {
      if (typeof v !== "string") {
        return undefined;
      }
      const t = v.trim();
      return t === "" ? undefined : t;
    },
    z.string().default("cursor-agent"),
  ),
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
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || process.env.DEEP_SEEK_API_KEY,
    deepseekModel: process.env.DEEPSEEK_MODEL,
    translationGlossary: process.env.WINNOW_TRANSLATION_GLOSSARY,
    inputMode: process.env.WINNOW_INPUT_MODE,
    outputMode: process.env.WINNOW_OUTPUT_MODE,
    profile: process.env.WINNOW_PROFILE,
    showOriginal: process.env.WINNOW_SHOW_ORIGINAL,
    dualOutput: process.env.WINNOW_DUAL_OUTPUT,
    cursorCommand: process.env.WINNOW_CURSOR_COMMAND,
    sessionId: process.env.WINNOW_SESSION_ID,
    uiWorkspaceDir: process.env.WINNOW_UI_WORKSPACE_DIR,
    logsEnabled: process.env.WINNOW_LOGS_ENABLED,
    logsDir: process.env.WINNOW_LOGS_DIR,
  });
}
