import { mkdir, opendir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, normalize, relative, resolve, sep } from "node:path";
import {
  extractYamlRefsFromSource,
  flattenYamlToKnobs,
  isLikelyConfigYamlName,
  knobLooksLikeConfigPath,
  parseSimpleYaml,
  resolveYamlRef,
  siblingConfigNames,
  type LinkedScriptConfig,
} from "./scriptYaml.js";

export type ScriptKnobKind = "int" | "float" | "bool" | "enum" | "path" | "text";

export type ScriptKnob = {
  id: string;
  flag: string;
  label: string;
  description: string;
  kind: ScriptKnobKind;
  default?: string;
  choices?: string[];
  lastValue?: string;
  required?: boolean;
  advanced?: boolean;
  origin?: "cli" | "yaml";
  yamlFile?: string;
  yamlKey?: string;
  sampleUsage?: string;
};

export type { LinkedScriptConfig } from "./scriptYaml.js";

export type ScriptScanEntry = {
  relPath: string;
  size: number;
  shebang: string;
  hasCli: boolean;
  blurb: string;
  knobs: ScriptKnob[];
  linkedConfigs: LinkedScriptConfig[];
  sampleCommand: string;
};

export type ScriptsIndex = {
  scannedAt: string;
  root: string;
  files: ScriptScanEntry[];
};

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  "target",
  ".winnow",
]);

const CANDIDATE_DIR_NAMES = new Set(["scripts", "tools", "experiments", "bin"]);
const SCRIPT_EXTS = new Set([".py", ".sh", ".bash", ".zsh", ".js", ".mjs", ".cjs", ".ts"]);

export function projectScriptIndexPath(projectRoot: string): string {
  return join(resolve(projectRoot), ".winnow", "scripts", "index.json");
}

export function resolveScriptFilePath(projectRoot: string, relPath: string): string {
  const root = resolve(projectRoot);
  const trimmed = relPath.trim();
  if (!trimmed) {
    throw new Error("path is required");
  }
  const normalized = normalize(trimmed);
  if (normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new Error("invalid path");
  }
  const abs = resolve(root, normalized);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || rel === "..") {
    throw new Error("path escapes workspace");
  }
  return abs;
}

export function looksLikeCliSource(source: string): boolean {
  return /\b(argparse|click|typer|absl\.flags|fire\.Fire|ArgumentParser|add_argument)\b/.test(source);
}

export function isTestLikePath(relPath: string): boolean {
  const lower = relPath.toLowerCase().split("/").join(sep);
  const base = basename(lower);
  if (base.startsWith("test_") || base.endsWith("_test.py") || base.endsWith(".test.js") || base.endsWith(".spec.ts")) {
    return true;
  }
  return /(^|\/)(tests?|__tests__)(\/|$)/.test(lower.replaceAll("\\", "/"));
}

export function extractModuleBlurb(source: string): string {
  const trimmed = source.replace(/^\uFEFF/, "").replace(/^#![^\n]*\n/, "");
  const triple = trimmed.match(/^[\s\n]*("""|''')([\s\S]*?)\1/);
  if (triple) {
    const body = triple[2].trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return body.slice(0, 4).join(" ").slice(0, 400);
  }
  const comments: string[] = [];
  for (const line of trimmed.split(/\r?\n/).slice(0, 20)) {
    const m = line.match(/^\s*#\s?(.*)$/);
    if (m) {
      comments.push(m[1].trim());
      continue;
    }
    if (comments.length > 0) {
      break;
    }
  }
  return comments.filter(Boolean).slice(0, 4).join(" ").slice(0, 400);
}

function flagToId(flag: string): string {
  return flag.replace(/^-+/, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase() || "arg";
}

function flagToLabel(flag: string): string {
  const id = flagToId(flag);
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferKind(typeName: string, defaultValue: string, choices: string[]): ScriptKnobKind {
  if (choices.length > 0) {
    return "enum";
  }
  const type = typeName.toLowerCase();
  if (type === "int" || type === "integer") {
    return "int";
  }
  if (type === "float" || type === "double") {
    return "float";
  }
  if (type === "bool" || type === "boolean" || defaultValue === "True" || defaultValue === "False" || defaultValue === "true" || defaultValue === "false") {
    return "bool";
  }
  if (type.includes("path") || /path|dir|file/i.test(typeName)) {
    return "path";
  }
  return "text";
}

function parseKwargString(block: string, key: string): string {
  const re = new RegExp(`${key}\\s*=\\s*(["'])([\\s\\S]*?)\\1`);
  const match = block.match(re);
  return match ? match[2].trim() : "";
}

function parseKwargBare(block: string, key: string): string {
  const re = new RegExp(`${key}\\s*=\\s*([^,\\)]+)`);
  const match = block.match(re);
  return match ? match[1].trim() : "";
}

function parseChoices(block: string): string[] {
  const match = block.match(/choices\s*=\s*\[([^\]]*)\]/);
  if (!match) {
    return [];
  }
  return match[1]
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function knobsFromCall(block: string): ScriptKnob[] {
  const flags = [...block.matchAll(/(['"])(--?[A-Za-z][\w-]*)\1/g)].map((m) => m[2]);
  const longFlags = flags.filter((flag) => flag.startsWith("--"));
  const useFlags = longFlags.length > 0 ? longFlags : flags;
  if (useFlags.length === 0) {
    return [];
  }
  const help = parseKwargString(block, "help");
  const typeName = parseKwargBare(block, "type").replace(/['"]/g, "");
  const defaultValue = parseKwargBare(block, "default").replace(/^["']|["']$/g, "");
  const choices = parseChoices(block);
  const required = /\brequired\s*=\s*True\b/.test(block);
  const flag = useFlags[useFlags.length - 1];
  return [
    {
      id: flagToId(flag),
      flag,
      label: flagToLabel(flag),
      description: help,
      kind: inferKind(typeName, defaultValue, choices),
      default: defaultValue || undefined,
      choices: choices.length > 0 ? choices : undefined,
      origin: "cli" as const,
      required: required || undefined,
    },
  ];
}

export function extractKnobsFromSource(source: string): ScriptKnob[] {
  const knobs: ScriptKnob[] = [];
  const seen = new Set<string>();
  const callRe = /\b(?:add_argument|option|Option)\s*\(([\s\S]*?)\)/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(source))) {
    for (const knob of knobsFromCall(match[1] || "")) {
      if (seen.has(knob.id)) {
        continue;
      }
      seen.add(knob.id);
      knobs.push(knob);
    }
  }
  return knobs;
}

export function sampleUsageForKnob(knob: ScriptKnob): string {
  if (knob.sampleUsage) {
    return knob.sampleUsage;
  }
  if (knob.origin === "yaml") {
    const value = knob.lastValue || knob.default || sampleValueForKind(knob);
    return `${knob.yamlFile || "config.yaml"} → ${knob.yamlKey || knob.flag}: ${value}`;
  }
  const flag = knob.flag || `--${knob.id}`;
  if (knob.kind === "bool") {
    const truthy = !["false", "False", "0"].includes(String(knob.default || "true"));
    return truthy ? flag : `${flag} false`;
  }
  const value = knob.lastValue || knob.default || knob.choices?.[0] || sampleValueForKind(knob);
  return `${flag} ${value}`;
}

function sampleValueForKind(knob: ScriptKnob): string {
  if (knob.kind === "int") {
    return "1";
  }
  if (knob.kind === "float") {
    return "0.1";
  }
  if (knob.kind === "path") {
    return knob.yamlFile || "./data";
  }
  if (knob.kind === "enum") {
    return knob.choices?.[0] || "value";
  }
  return "value";
}

export function withSampleUsages(knobs: ScriptKnob[]): ScriptKnob[] {
  return knobs.map((knob) => ({ ...knob, sampleUsage: sampleUsageForKnob(knob) }));
}

export function buildSampleCommand(relPath: string, knobs: ScriptKnob[]): string {
  const exe = relPath.toLowerCase().endsWith(".py") ? ["python3", "-u", relPath] : [relPath];
  const cliKnobs = knobs.filter((knob) => knob.origin !== "yaml").slice(0, 8);
  const parts = [...exe];
  for (const knob of cliKnobs) {
    const usage = sampleUsageForKnob(knob);
    const bits = usage.split(/\s+/);
    if (bits[0]?.startsWith("-")) {
      parts.push(...bits);
    }
  }
  const yaml = knobs.find((knob) => knob.origin === "yaml" && knob.yamlFile);
  const hasConfigFlag = knobs.some((knob) => knobLooksLikeConfigPath(knob));
  if (yaml && !hasConfigFlag) {
    parts.push("--config", yaml.yamlFile || "");
  }
  return parts.filter(Boolean).join(" ");
}

function firstShebang(source: string): string {
  const line = source.split(/\r?\n/, 1)[0] || "";
  return line.startsWith("#!") ? line.slice(2).trim() : "";
}

function isCandidatePath(relPath: string, inCandidateDir: boolean): boolean {
  if (isTestLikePath(relPath)) {
    return false;
  }
  const ext = relPath.includes(".") ? `.${relPath.split(".").pop()?.toLowerCase() || ""}` : "";
  const base = basename(relPath);
  const atRoot = !relPath.includes("/");
  if (inCandidateDir && SCRIPT_EXTS.has(ext)) {
    return true;
  }
  if (atRoot && SCRIPT_EXTS.has(ext)) {
    return true;
  }
  if (base.endsWith(".py") || base.endsWith(".sh")) {
    return inCandidateDir || atRoot;
  }
  return false;
}

async function walkScripts(projectRoot: string): Promise<ScriptScanEntry[]> {
  const root = resolve(projectRoot);
  const out: ScriptScanEntry[] = [];
  const yamlAbs = new Map<string, string>();

  async function walk(absDir: string, inCandidateDir: boolean): Promise<void> {
    let handle;
    try {
      handle = await opendir(absDir);
    } catch {
      return;
    }
    for await (const ent of handle) {
      const abs = join(absDir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIR_NAMES.has(ent.name)) {
          continue;
        }
        const nextCandidate = inCandidateDir || CANDIDATE_DIR_NAMES.has(ent.name.toLowerCase());
        await walk(abs, nextCandidate);
        continue;
      }
      if (!ent.isFile()) {
        continue;
      }
      const rel = relative(root, abs).split(sep).join("/");
      if (rel.startsWith("..")) {
        continue;
      }
      const ext = `.${ent.name.split(".").pop()?.toLowerCase() || ""}`;
      if (ext === ".yaml" || ext === ".yml") {
        yamlAbs.set(rel, abs);
        continue;
      }
      if (!SCRIPT_EXTS.has(ext) && !isCandidatePath(rel, inCandidateDir)) {
        continue;
      }
      if (!isCandidatePath(rel, inCandidateDir) && !SCRIPT_EXTS.has(ext)) {
        continue;
      }
      let source = "";
      try {
        source = await readFile(abs, "utf8");
      } catch {
        continue;
      }
      const hasCli = looksLikeCliSource(source);
      const inDir = inCandidateDir || CANDIDATE_DIR_NAMES.has(basename(dirname(abs)).toLowerCase());
      const atRoot = !rel.includes("/");
      if (!inDir && !atRoot && !hasCli) {
        continue;
      }
      if (isTestLikePath(rel)) {
        continue;
      }
      if (!inDir && !atRoot && hasCli && !SCRIPT_EXTS.has(ext)) {
        continue;
      }
      const st = await stat(abs).catch(() => null);
      if (!st) {
        continue;
      }
      const knobs = withSampleUsages(extractKnobsFromSource(source));
      out.push({
        relPath: rel,
        size: st.size,
        shebang: firstShebang(source),
        hasCli,
        blurb: extractModuleBlurb(source),
        knobs,
        linkedConfigs: [],
        sampleCommand: "",
        source,
      } as ScriptScanEntry & { source?: string });
    }
  }

  await walk(root, false);
  const yamlRels = [...yamlAbs.keys()];
  for (const entry of out) {
    const withSource = entry as ScriptScanEntry & { source?: string };
    const source = withSource.source || "";
    delete withSource.source;
    const linked = await attachLinkedYaml(root, entry.relPath, source, entry.knobs, yamlRels, yamlAbs);
    entry.linkedConfigs = linked;
    const combined = withSampleUsages([...entry.knobs, ...linked.flatMap((item) => item.knobs)]);
    entry.knobs = combined;
    entry.sampleCommand = buildSampleCommand(entry.relPath, combined);
  }
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

async function attachLinkedYaml(
  root: string,
  scriptRel: string,
  source: string,
  knobs: ScriptKnob[],
  yamlRels: string[],
  yamlAbs: Map<string, string>,
): Promise<LinkedScriptConfig[]> {
  const existingRef = (ref: string): string | null => {
    const resolved = resolveYamlRef(scriptRel, ref, root);
    return resolved && yamlAbs.has(resolved) ? resolved : null;
  };
  const refs = extractYamlRefsFromSource(source)
    .map((ref) => existingRef(ref))
    .filter((rel): rel is string => Boolean(rel));
  const fromDefaults = knobs
    .filter((knob) => knobLooksLikeConfigPath(knob) && knob.default)
    .map((knob) => existingRef(String(knob.default)))
    .filter((rel): rel is string => Boolean(rel));
  const siblings = siblingConfigNames(scriptRel).filter((rel) => yamlAbs.has(rel));
  const want = new Set([...refs, ...fromDefaults, ...siblings]);
  for (const rel of yamlRels) {
    if (dirname(rel) === dirname(scriptRel) && isLikelyConfigYamlName(rel)) {
      want.add(rel);
    }
  }
  const linked: LinkedScriptConfig[] = [];
  for (const rel of want) {
    const abs = yamlAbs.get(rel);
    if (!abs) {
      continue;
    }
    try {
      const raw = await readFile(abs, "utf8");
      const knobsFromYaml = withSampleUsages(flattenYamlToKnobs(rel, parseSimpleYaml(raw)));
      linked.push({ relPath: rel, knobs: knobsFromYaml });
    } catch {
      linked.push({ relPath: rel, knobs: [] });
    }
  }
  return linked;
}

export async function rebuildAndWriteScriptIndex(projectRoot: string): Promise<ScriptsIndex> {
  const root = resolve(projectRoot);
  await mkdir(join(root, ".winnow", "scripts"), { recursive: true });
  const files = await walkScripts(root);
  const index: ScriptsIndex = {
    scannedAt: new Date().toISOString(),
    root,
    files,
  };
  await writeFile(projectScriptIndexPath(root), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}

export async function readScriptIndex(projectRoot: string): Promise<ScriptsIndex | null> {
  try {
    const raw = await readFile(projectScriptIndexPath(projectRoot), "utf8");
    const parsed = JSON.parse(raw) as ScriptsIndex;
    if (!parsed || !Array.isArray(parsed.files)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
