import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Declarative list: order matches `.env.example` and the Settings form. */
export type DotenvVarSpec = {
  key: string;
  description?: string;
  /** If true, UI masks value; empty POST keeps previous file value. */
  sensitive?: boolean;
};

export const WINNOW_DOTENV_SPECS: DotenvVarSpec[] = [
  { key: "WINNOW_TRANSLATOR_BACKEND", description: "ollama | deepseek_api" },
  { key: "WINNOW_TRANSLATOR_TIMEOUT_MS", description: "Translation HTTP timeout (ms)" },
  { key: "WINNOW_TRANSLATOR_RETRIES", description: "Retries per translation request" },
  { key: "OLLAMA_BASE_URL", description: "Ollama API base URL" },
  { key: "OLLAMA_TRANSLATION_MODEL", description: "Ollama model name for translation" },
  { key: "DEEPSEEK_BASE_URL", description: "DeepSeek API host (no path); see .env.example" },
  {
    key: "DEEPSEEK_API_KEY",
    sensitive: true,
    description: "Must be DEEPSEEK_API_KEY (not DEEP_SEEK_API_KEY)",
  },
  { key: "OPENAI_API_KEY", sensitive: true, description: "OpenAI API key for external model usage" },
  { key: "ANTHROPIC_API_KEY", sensitive: true, description: "Anthropic API key for external model usage" },
  { key: "GEMINI_API_KEY", sensitive: true, description: "Gemini API key for external model usage" },
  { key: "DEEPSEEK_MODEL", description: "e.g. deepseek-v4-flash" },
  { key: "WINNOW_TRANSLATION_GLOSSARY", description: "Comma-separated glossary hints" },
  { key: "WINNOW_INPUT_MODE", description: "off | zh_to_en" },
  { key: "WINNOW_OUTPUT_MODE", description: "off | en_to_zh" },
  { key: "WINNOW_PROFILE", description: "learning_zh | engineering_exact" },
  { key: "WINNOW_SHOW_ORIGINAL", description: "true | false (show English before Chinese)" },
  { key: "WINNOW_DUAL_OUTPUT", description: "true | false (dual EN/ZH output)" },
  { key: "WINNOW_CURSOR_COMMAND", description: "cursor-agent binary name or path" },
  { key: "WINNOW_SESSION_ID", description: "Optional default Cursor session id" },
  { key: "WINNOW_UI_WORKSPACE_DIR", description: "Optional default UI workspace path" },
  { key: "WINNOW_LOGS_ENABLED", description: "true | false" },
  { key: "WINNOW_LOGS_DIR", description: "Relative or absolute log directory" },
  {
    key: "WINNOW_AGENT_TRANSCRIPTS_DIR",
    description: "Optional override for Cursor agent-transcripts directory",
  },
];

const SPEC_KEY_SET = new Set(WINNOW_DOTENV_SPECS.map((s) => s.key));

export function parseDotenvContent(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) {
      continue;
    }
    const eq = t.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function readDotenvFile(cwd: string): Record<string, string> {
  const p = join(cwd, ".env");
  if (!existsSync(p)) {
    return {};
  }
  return parseDotenvContent(readFileSync(p, "utf8"));
}

function escapeEnvValue(v: string): string {
  if (v === "") {
    return "";
  }
  if (/[\s#"'\\]/.test(v)) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return v;
}

/** Writes known Winnow keys in spec order, then any extra keys from `all` (alphabetically). */
export function writeDotenvFileFull(cwd: string, all: Record<string, string>): void {
  const lines: string[] = [];
  lines.push("# Winnow environment (edit here or use Console → Settings)");
  lines.push("# Variable names must match this file / .env.example (e.g. DEEPSEEK_API_KEY).");
  lines.push("");
  for (const spec of WINNOW_DOTENV_SPECS) {
    if (spec.description) {
      lines.push(`# ${spec.description}`);
    }
    lines.push(`${spec.key}=${escapeEnvValue(all[spec.key] ?? "")}`);
    lines.push("");
  }
  const extra = Object.keys(all)
    .filter((k) => !SPEC_KEY_SET.has(k))
    .sort((a, b) => a.localeCompare(b));
  if (extra.length > 0) {
    lines.push("# Additional variables (preserved from previous .env)");
    for (const k of extra) {
      lines.push(`${k}=${escapeEnvValue(all[k] ?? "")}`);
    }
    lines.push("");
  }
  writeFileSync(join(cwd, ".env"), lines.join("\n").trimEnd() + "\n", "utf8");
}

/**
 * Load `.env` from cwd into `process.env`.
 * Default: do not override variables already set in the shell.
 */
export function loadDotenvFromDisk(
  cwd: string,
  options: { override: boolean } = { override: false },
): void {
  const record = readDotenvFile(cwd);
  for (const [key, val] of Object.entries(record)) {
    if (options.override || process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}
