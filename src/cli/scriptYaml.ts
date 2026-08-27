import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { ScriptKnob, ScriptKnobKind } from "./scriptIndex.js";

export type LinkedScriptConfig = {
  relPath: string;
  knobs: ScriptKnob[];
};

const YAML_REF_RE = /['"]([^'"]+\.ya?ml)['"]/gi;
const CONFIG_FLAG_IDS = new Set(["config", "cfg", "yaml", "conf", "hydra-config", "config-path", "config-name"]);

export function extractYamlRefsFromSource(source: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(YAML_REF_RE.source, YAML_REF_RE.flags);
  while ((match = re.exec(source))) {
    const ref = String(match[1] || "").replaceAll("\\", "/").trim();
    if (ref && !ref.startsWith("http")) {
      found.add(ref);
    }
  }
  return [...found];
}

export function isLikelyConfigYamlName(name: string): boolean {
  const base = basename(name).toLowerCase();
  if (!base.endsWith(".yaml") && !base.endsWith(".yml")) {
    return false;
  }
  return /^(config|conf|params|settings|hyperparams?|defaults|hydra|experiment|train|run)([._-].*)?\.ya?ml$/.test(base);
}

export function knobLooksLikeConfigPath(knob: Pick<ScriptKnob, "id" | "flag" | "kind" | "default">): boolean {
  const id = (knob.id || "").toLowerCase();
  const flag = (knob.flag || "").toLowerCase();
  const def = String(knob.default || "");
  if (CONFIG_FLAG_IDS.has(id) || CONFIG_FLAG_IDS.has(flag.replace(/^-+/, ""))) {
    return true;
  }
  return /\.ya?ml$/i.test(def);
}

export function parseSimpleYaml(text: string): unknown {
  const lines = text.replace(/\t/g, "  ").split(/\r?\n/);
  type Frame = { indent: number; value: unknown };
  const root: Record<string, unknown> = {};
  const stack: Frame[] = [{ indent: -1, value: root }];

  const currentMap = (): Record<string, unknown> => {
    const top = stack[stack.length - 1]?.value;
    if (top && typeof top === "object" && !Array.isArray(top)) {
      return top as Record<string, unknown>;
    }
    return root;
  };

  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith("#")) {
      continue;
    }
    const indent = raw.match(/^ */)?.[0].length ?? 0;
    const line = raw.trim();
    while (stack.length > 1 && indent <= (stack[stack.length - 1]?.indent ?? 0)) {
      stack.pop();
    }
    const listMatch = line.match(/^- (.*)$/);
    if (listMatch) {
      const parent = stack[stack.length - 1];
      if (!parent) {
        continue;
      }
      if (!Array.isArray(parent.value)) {
        continue;
      }
      (parent.value as unknown[]).push(parseYamlScalar(listMatch[1] || ""));
      continue;
    }
    const kv = line.match(/^([^:#]+):(.*)$/);
    if (!kv) {
      continue;
    }
    const key = kv[1].trim();
    const rest = kv[2].trim();
    const map = currentMap();
    if (!rest) {
      const child: Record<string, unknown> = {};
      map[key] = child;
      stack.push({ indent, value: child });
      continue;
    }
    if (rest === "[]") {
      map[key] = [];
      continue;
    }
    if (rest === "{}") {
      map[key] = {};
      continue;
    }
    map[key] = parseYamlScalar(rest);
  }
  return root;
}

function parseYamlScalar(raw: string): unknown {
  const value = raw.replace(/\s+#.*$/, "").trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === "true" || value === "True") {
    return true;
  }
  if (value === "false" || value === "False") {
    return false;
  }
  if (value === "null" || value === "~" || value === "None") {
    return null;
  }
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return Number(value);
  }
  return value;
}

function kindFromYamlValue(value: unknown): ScriptKnobKind {
  if (typeof value === "boolean") {
    return "bool";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? "int" : "float";
  }
  if (typeof value === "string" && /(\.ya?ml|\/|\\|\.json)$/i.test(value)) {
    return "path";
  }
  return "text";
}

export function flattenYamlToKnobs(yamlRelPath: string, parsed: unknown, prefix = ""): ScriptKnob[] {
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const knobs: ScriptKnob[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      knobs.push(...flattenYamlToKnobs(yamlRelPath, value, path));
      continue;
    }
    if (Array.isArray(value)) {
      continue;
    }
    const id = `yaml-${yamlRelPath}-${path}`.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
    knobs.push({
      id,
      flag: path,
      label: path
        .split(".")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" / "),
      description: `YAML key in ${yamlRelPath}`,
      kind: kindFromYamlValue(value),
      default: value == null ? undefined : String(value),
      origin: "yaml",
      yamlFile: yamlRelPath,
      yamlKey: path,
    });
    if (knobs.length >= 24) {
      break;
    }
  }
  return knobs.slice(0, 24);
}

export function resolveYamlRef(scriptRelPath: string, ref: string, projectRoot: string): string | null {
  const scriptDir = dirname(scriptRelPath);
  const cleaned = ref.replace(/^\.\//, "").replaceAll("\\", "/");
  const candidates = [join(scriptDir, cleaned).split(sep).join("/"), cleaned];
  for (const rel of candidates) {
    const normalized = rel.split(sep).join("/").replace(/^\.\//, "");
    if (!normalized || normalized.startsWith("..")) {
      continue;
    }
    const abs = resolve(projectRoot, normalized);
    const relToRoot = relative(resolve(projectRoot), abs).split(sep).join("/");
    if (!relToRoot.startsWith("..")) {
      return relToRoot;
    }
  }
  return null;
}

export function siblingConfigNames(scriptRelPath: string): string[] {
  const dir = dirname(scriptRelPath);
  const prefix = dir === "." ? "" : `${dir}/`;
  return ["config.yaml", "config.yml", "conf.yaml", "params.yaml", "settings.yaml"].map((name) => `${prefix}${name}`);
}
