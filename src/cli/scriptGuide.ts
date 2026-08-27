import { basename, relative, resolve, sep } from "node:path";
import type { ScriptKnob } from "./scriptIndex.js";

export type ProposedScriptCommand = {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  notes: string;
  knobs?: ScriptKnob[];
};

const DEFAULT_STALL_MS = 45_000;
const DEFAULT_GRACE_MS = 8_000;
const DEFAULT_MAX_RUNTIME_MS = 2 * 60 * 60 * 1000;
const SUMMARIZE_LOG_TAIL_CHARS = 12_000;

export const SCRIPT_RUN_DEFAULTS = {
  stallMs: DEFAULT_STALL_MS,
  graceMs: DEFAULT_GRACE_MS,
  maxRuntimeMs: DEFAULT_MAX_RUNTIME_MS,
  summarizeLogTailChars: SUMMARIZE_LOG_TAIL_CHARS,
};

export function extractJsonFence(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return fenced[1].trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }
  return null;
}

export function parseProposedCommand(text: string): ProposedScriptCommand {
  const raw = extractJsonFence(text);
  if (!raw) {
    throw new Error("agent did not emit a JSON command block");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("agent JSON command block was invalid");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("agent JSON command block was not an object");
  }
  const rec = parsed as Record<string, unknown>;
  const argv = Array.isArray(rec.argv) ? rec.argv.map((item) => String(item)) : [];
  if (argv.length === 0) {
    throw new Error("proposed argv is empty");
  }
  const env: Record<string, string> = {};
  if (rec.env && typeof rec.env === "object" && !Array.isArray(rec.env)) {
    for (const [key, value] of Object.entries(rec.env as Record<string, unknown>)) {
      if (typeof key === "string" && key.trim()) {
        env[key.trim()] = String(value ?? "");
      }
    }
  }
  return {
    argv,
    cwd: typeof rec.cwd === "string" && rec.cwd.trim() ? rec.cwd.trim() : ".",
    env,
    notes: typeof rec.notes === "string" ? rec.notes.trim() : "",
    knobs: Array.isArray(rec.knobs) ? (rec.knobs as ScriptKnob[]) : undefined,
  };
}

export function mergeKnobs(existing: ScriptKnob[], incoming: ScriptKnob[], userEditedIds: string[] = []): ScriptKnob[] {
  const edited = new Set(userEditedIds);
  const byId = new Map<string, ScriptKnob>();
  for (const knob of existing) {
    byId.set(knob.id || knob.flag, { ...knob });
  }
  for (const knob of incoming) {
    if (!knob || !(knob.id || knob.flag)) {
      continue;
    }
    const id = knob.id || knob.flag.replace(/^-+/, "");
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, { ...knob, id });
      continue;
    }
    const keepDescription = edited.has(id) || (prev.description || "").trim().length > 0;
    byId.set(id, {
      ...prev,
      ...knob,
      id,
      description: keepDescription ? prev.description || knob.description : knob.description,
      label: edited.has(id) ? prev.label : knob.label || prev.label,
      lastValue: prev.lastValue || knob.lastValue,
    });
  }
  return [...byId.values()];
}

export function formatCommandPreview(argv: string[]): string {
  return argv
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

export function resolveUnderWorkspace(projectRoot: string, maybePath: string): string {
  const root = resolve(projectRoot);
  const abs = resolve(root, maybePath || ".");
  const rel = relative(root, abs);
  if (rel.startsWith("..") || rel === "..") {
    throw new Error("path escapes workspace");
  }
  return abs;
}

export function sanitizeEnv(env: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    out[key] = String(value ?? "");
  }
  return out;
}

export function buildSpawnArgv(projectRoot: string, proposed: ProposedScriptCommand): {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  preview: string;
} {
  const cwd = resolveUnderWorkspace(projectRoot, proposed.cwd || ".");
  const argv = [...proposed.argv];
  if (argv.length === 0) {
    throw new Error("argv is required");
  }
  if (/\.py$/i.test(argv[0]) && !/(^|[\\/])python(\d+(\.\d+)?)?(\.exe)?$/.test(argv[0].toLowerCase())) {
    argv.unshift("python3");
  }
  let file = argv[0];
  let args = argv.slice(1);
  const lowerFile = file.toLowerCase();
  const isPython = /(^|[\\/])python(\d+(\.\d+)?)?(\.exe)?$/.test(lowerFile) || lowerFile === "python" || lowerFile === "python3";
  if (isPython) {
    file = file === "python" ? "python3" : file;
    const hasU = args.includes("-u");
    if (!hasU) {
      args = ["-u", ...args];
    }
  }
  const scriptLike = args.find((part) => /\.(py|sh|bash|js|mjs|cjs|ts)$/i.test(part));
  if (scriptLike && (scriptLike.includes("/") || scriptLike.includes("\\") || scriptLike.endsWith(".py") || scriptLike.endsWith(".sh"))) {
    resolveUnderWorkspace(projectRoot, scriptLike);
  }
  const env = {
    PYTHONUNBUFFERED: "1",
    ...sanitizeEnv(proposed.env),
  };
  return {
    file,
    args,
    cwd,
    env,
    preview: formatCommandPreview([file, ...args]),
  };
}

export function buildInspectPrompt(relPath: string, sourceExcerpt: string, existing: ScriptKnob[]): string {
  return [
    "You are indexing a research/experiment script for Winnow's Scripts tab.",
    `Script path: ${relPath}`,
    "Read the file (excerpt below may be truncated). List every CLI knob a future user can adjust.",
    "Do not run the script. Do not propose a command.",
    "Return ONLY a JSON fenced block:",
    '```json',
    '{ "knobs": [ { "id": "epochs", "flag": "--epochs", "label": "Training epochs", "description": "How many passes over the data", "kind": "int", "default": "10", "required": false, "advanced": false } ] }',
    "```",
    "YAML sidecar files are configs, not scripts. Keep origin=yaml knobs (yamlFile + yamlKey) and origin=cli flags distinct.",
    existing.length > 0 ? `Existing knobs (upgrade descriptions, do not drop flags):\n${JSON.stringify(existing, null, 2)}` : "No knobs extracted yet.",
    "## Source excerpt",
    sourceExcerpt.slice(0, 8000),
  ].join("\n\n");
}

export function buildProposePrompt(input: {
  relPath: string;
  blurb: string;
  knobs: ScriptKnob[];
  intent: string;
  lastRuns: Array<{ intent?: string; argv: string[]; summary?: string; startedAt?: string }>;
  sampleCommand?: string;
  linkedConfigs?: Array<{ relPath: string }>;
}): string {
  const knobLegend = input.knobs.length
    ? input.knobs
        .map((knob) => {
          const origin = knob.origin === "yaml" ? `yaml ${knob.yamlFile || ""} ${knob.yamlKey || knob.flag}` : `cli ${knob.flag}`;
          const sample = knob.sampleUsage ? ` sample=${knob.sampleUsage}` : "";
          return `- ${knob.label} (${origin}): ${knob.description || "(no description)"} default=${knob.default ?? "?"} last=${knob.lastValue ?? "?"} kind=${knob.kind}${sample}`;
        })
        .join("\n")
    : "(no knobs indexed)";
  const history = input.lastRuns.length
    ? input.lastRuns
        .slice(0, 5)
        .map((run) => `- ${run.startedAt || ""} ${formatCommandPreview(run.argv)}${run.summary ? ` :: ${run.summary.slice(0, 180)}` : ""}`)
        .join("\n")
    : "(no previous runs)";
  return [
    "You are preparing a confirmed command for a research script. Do not execute it.",
    `Script: ${input.relPath}`,
    input.blurb ? `What it does: ${input.blurb}` : "",
    "## Knobs (what the user can adjust)",
    knobLegend,
    input.sampleCommand ? `## Sample usage from scan\n${input.sampleCommand}` : "",
    input.linkedConfigs?.length
      ? `## Linked YAML configs (sidecars, not runnable)\n${input.linkedConfigs.map((item) => `- ${item.relPath}`).join("\n")}`
      : "",
    "## Last runs",
    history,
    "## User intent (high-level, not raw argv)",
    input.intent.trim() || "(use last recipe / defaults)",
    "Return ONLY a JSON fenced block with argv as an array of strings (no shell piping). Example:",
    "```json",
    `{ "argv": ["python3", "-u", "${input.relPath}"], "cwd": ".", "env": {}, "notes": "why these flags", "knobs": [] }`,
    "```",
    "argv must stay inside this workspace. Prefer python3 -u for .py files.",
    "YAML knobs are config keys, not extra argv unless the script takes --config. Prefer passing the yaml path plus CLI flags.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildSummarizePrompt(input: {
  relPath: string;
  argv: string[];
  intent: string;
  exitCode: number | null;
  stopped: boolean;
  stalled: boolean;
  logTail: string;
}): string {
  const outcome = input.stalled
    ? "The run stalled (no output) and was stopped. Do not describe it as a successful experiment."
    : input.stopped
      ? "The run was interrupted/stopped. Do not describe it as a successful experiment."
      : input.exitCode === 0
        ? "The process exited 0."
        : `The process exited with code ${input.exitCode}.`;
  return [
    "Summarize this research script run for a future operator. Do not dump the raw log.",
    `Script: ${input.relPath}`,
    `Command: ${formatCommandPreview(input.argv)}`,
    `Intent: ${input.intent || "(none)"}`,
    outcome,
    "Write a short markdown insight: what was tried, what happened, artifacts/paths mentioned, what to try next.",
    "## Log tail (may be truncated)",
    input.logTail.slice(-SUMMARIZE_LOG_TAIL_CHARS) || "(no output)",
  ].join("\n\n");
}

export function parseInspectedKnobs(text: string): ScriptKnob[] {
  const raw = extractJsonFence(text);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as { knobs?: ScriptKnob[] };
    return Array.isArray(parsed.knobs) ? parsed.knobs.filter((item) => item && (item.flag || item.id)) : [];
  } catch {
    return [];
  }
}

export function knobCountLabel(count: number): string {
  if (count <= 0) {
    return "no knobs";
  }
  return count === 1 ? "1 knob" : `${count} knobs`;
}

export function shouldWarnStall(lastOutputAtMs: number, nowMs: number, stallMs: number): boolean {
  return nowMs - lastOutputAtMs >= stallMs;
}

export function shouldStopForMaxRuntime(startedAtMs: number, nowMs: number, maxRuntimeMs: number): boolean {
  return nowMs - startedAtMs >= maxRuntimeMs;
}
