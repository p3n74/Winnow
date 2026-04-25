import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { WinnowConfig } from "./schema.js";

const PROFILE_PATH = ".winnow/profile.json";

type ProfileConfig = Partial<
  Pick<
    WinnowConfig,
    | "translatorBackend"
    | "ollamaTranslationModel"
    | "deepseekModel"
    | "translationGlossary"
    | "inputMode"
    | "outputMode"
    | "profile"
    | "showOriginal"
    | "dualOutput"
    | "translatorTimeoutMs"
    | "translatorRetries"
    | "uiWorkspaceDir"
  >
>;

export async function loadProjectProfile(): Promise<ProfileConfig | undefined> {
  try {
    const filePath = join(process.cwd(), PROFILE_PATH);
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as ProfileConfig;
  } catch {
    return undefined;
  }
}

export async function saveProjectProfile(config: WinnowConfig): Promise<void> {
  const filePath = join(process.cwd(), PROFILE_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  const profile: ProfileConfig = {
    translatorBackend: config.translatorBackend,
    ollamaTranslationModel: config.ollamaTranslationModel,
    deepseekModel: config.deepseekModel,
    translationGlossary: config.translationGlossary,
    inputMode: config.inputMode,
    outputMode: config.outputMode,
    profile: config.profile,
    showOriginal: config.showOriginal,
    dualOutput: config.dualOutput,
    translatorTimeoutMs: config.translatorTimeoutMs,
    translatorRetries: config.translatorRetries,
    uiWorkspaceDir: config.uiWorkspaceDir,
  };
  await writeFile(filePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
}

export function applyProjectProfile(base: WinnowConfig, profile?: ProfileConfig): WinnowConfig {
  if (!profile) {
    return base;
  }
  return { ...base, ...profile };
}
