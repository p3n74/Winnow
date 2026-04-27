import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ExternalProvider = "deepseek" | "openai" | "anthropic" | "gemini" | "universal";

export type ProviderDefinition = {
  id: ExternalProvider;
  label: string;
  envKey: string;
  defaultModels: string[];
  supportsCustomBaseUrl?: boolean;
  requiresModelOnSmoke?: boolean;
};

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    defaultModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
  },
  {
    id: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    defaultModels: ["gpt-4.1-mini", "gpt-4.1", "o4-mini"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    defaultModels: ["claude-3-5-haiku-latest", "claude-3-7-sonnet-latest", "claude-sonnet-4-0"],
  },
  {
    id: "gemini",
    label: "Gemini",
    envKey: "GEMINI_API_KEY",
    defaultModels: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  },
  {
    id: "universal",
    label: "Universal (OpenAI-compatible)",
    envKey: "UNIVERSAL_MODEL_API_KEY",
    defaultModels: [],
    supportsCustomBaseUrl: true,
    requiresModelOnSmoke: true,
  },
];

export type ProviderVerification = {
  provider: ExternalProvider;
  verifiedAt: string;
  models: string[];
  baseUrl?: string;
};

export type ProviderVerificationStore = Partial<Record<ExternalProvider, ProviderVerification>>;

const VERIFIED_PROVIDERS_PATH = ".winnow/provider-verification.json";

export function getProviderDefinition(provider: ExternalProvider): ProviderDefinition {
  const found = PROVIDERS.find((p) => p.id === provider);
  if (!found) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return found;
}

export async function readProviderVerificationStore(workspaceRoot: string): Promise<ProviderVerificationStore> {
  try {
    const content = await readFile(join(workspaceRoot, VERIFIED_PROVIDERS_PATH), "utf8");
    const parsed = JSON.parse(content) as ProviderVerificationStore;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export async function writeProviderVerificationStore(
  workspaceRoot: string,
  store: ProviderVerificationStore,
): Promise<void> {
  const filePath = join(workspaceRoot, VERIFIED_PROVIDERS_PATH);
  await mkdir(join(workspaceRoot, ".winnow"), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}
