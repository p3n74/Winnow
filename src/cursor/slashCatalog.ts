import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { basename, dirname, join } from "node:path";

export type SlashItemKind = "mode" | "command" | "skill" | "winnow" | "builtin-skill";

export type SlashCatalogItem = {
  kind: SlashItemKind;
  /** Unique across the catalog; file-backed items use `${kind}:${name}`. */
  id: string;
  /** Slash token without the leading slash. */
  name: string;
  description: string;
  source: "project" | "user" | "winnow" | "cursor-builtin";
  disableModelInvocation?: boolean;
  icon?: string;
  color?: string;
};

export type SlashInvocation = {
  kind: "command" | "skill" | "winnow" | "builtin-skill";
  id: string;
};

type CatalogEntry = {
  item: SlashCatalogItem;
  body: string;
};

/** Same prompts as the composer quickbar chips, so we do not keep two prompt libraries. */
const WINNOW_PRESET_BODIES: Record<string, string> = {
  "winnow:implement-tests": "Implement the requested change with tests, then summarize what changed.",
  "winnow:review": "Review this code for bugs and edge cases, then propose a minimal patch.",
  "winnow:refactor": "Refactor this code for readability without changing behavior.",
};

export const WINNOW_SLASH_PRESETS: SlashCatalogItem[] = [
  {
    kind: "winnow",
    id: "winnow:implement-tests",
    name: "implement-tests",
    description: "Implement the change with tests, then summarize what changed.",
    source: "winnow",
  },
  {
    kind: "winnow",
    id: "winnow:review",
    name: "review",
    description: "Review for bugs and edge cases, then propose a minimal patch.",
    source: "winnow",
  },
  {
    kind: "winnow",
    id: "winnow:refactor",
    name: "refactor",
    description: "Refactor for readability without changing behavior.",
    source: "winnow",
  },
];

/** Managed by Cursor, not files on disk. Names only; expansion is a leading `/name`. */
export const CURSOR_BUILTIN_SKILLS: SlashCatalogItem[] = [
  { name: "create-rule", description: "Create a Cursor rule for persistent guidance." },
  { name: "create-skill", description: "Author a new Cursor Agent Skill." },
  { name: "create-subagent", description: "Create a Cursor subagent definition." },
  { name: "review", description: "Review the current code changes." },
  { name: "review-bugbot", description: "Review local changes with Bugbot." },
  { name: "review-security", description: "Review local changes for security issues." },
  { name: "split-to-prs", description: "Split the current work into small reviewable PRs." },
  { name: "create-hook", description: "Create a Cursor hook." },
  { name: "cursor-blame", description: "Explain who and what changed a line." },
  { name: "migrate-to-skills", description: "Migrate commands to skills." },
].map((entry) => ({
  kind: "builtin-skill" as const,
  id: `builtin-skill:${entry.name}`,
  name: entry.name,
  description: entry.description,
  source: "cursor-builtin" as const,
}));

/** Mode rows exist for the palette only; `expandSlashPrompt` ignores them. */
export const MODE_SLASH_ITEMS: SlashCatalogItem[] = [
  {
    kind: "mode",
    id: "mode:agent",
    name: "agent",
    description: "Agent mode: edit files and run tools (default).",
    source: "cursor-builtin",
  },
  {
    kind: "mode",
    id: "mode:ask",
    name: "ask",
    description: "Ask mode: read-only answers, no edits.",
    source: "cursor-builtin",
  },
  {
    kind: "mode",
    id: "mode:plan",
    name: "plan",
    description: "Plan mode: research and propose a plan before editing.",
    source: "cursor-builtin",
  },
];

const COMMAND_EXTENSIONS = [".md", ".mdc", ".markdown", ".txt"];
const SKILL_DIR_SEGMENTS = [
  [".cursor", "skills"],
  [".agents", "skills"],
  [".claude", "skills"],
  [".codex", "skills"],
] as const;
const SKIP_DIR_NAMES = new Set(["node_modules", ".git", "dist"]);
const MAX_SKILL_WALK_DEPTH = 6;
const MAX_BODY_CHARS = 12000;
const SECTION_SEPARATOR = "\n\n---\n\n";

function filenameStem(filename: string): string {
  const base = basename(filename);
  const lower = base.toLowerCase();
  for (const ext of COMMAND_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return base.slice(0, base.length - ext.length).trim();
    }
  }
  return base.trim();
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseSimpleYamlMap(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) {
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = stripQuotes(line.slice(colon + 1).trim());
    if (!key) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function splitFrontmatter(markdown: string): { attrs: Record<string, string>; body: string } {
  const text = String(markdown ?? "").replace(/^\uFEFF/, "");
  const match = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) {
    return { attrs: {}, body: text.trim() };
  }
  return {
    attrs: parseSimpleYamlMap(match[1] ?? ""),
    body: text.slice(match[0].length).trim(),
  };
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "0") {
    return false;
  }
  return undefined;
}

function capBody(body: string): string {
  return body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body;
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function commandDirsForRoot(root: string): string[] {
  return [join(root, ".cursor", "commands")];
}

function skillDirsForRoot(root: string): string[] {
  return SKILL_DIR_SEGMENTS.map((segments) => join(root, ...segments));
}

function collectCommands(root: string, source: "project" | "user", into: Map<string, CatalogEntry>): void {
  for (const dir of commandDirsForRoot(root)) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const lower = entry.toLowerCase();
      if (!COMMAND_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        continue;
      }
      const markdown = readFileOrNull(join(dir, entry));
      if (markdown == null) {
        continue;
      }
      const { attrs, body } = splitFrontmatter(markdown);
      const name = (attrs.name || filenameStem(entry)).trim();
      if (!name) {
        continue;
      }
      into.set(name.toLowerCase(), {
        item: {
          kind: "command",
          id: `command:${name}`,
          name,
          description: (attrs.description || "").trim(),
          source,
        },
        body: capBody(body),
      });
    }
  }
}

function collectSkillFilesInDir(dir: string, depth: number, found: string[]): void {
  if (depth > MAX_SKILL_WALK_DEPTH) {
    return;
  }
  let entries: Dirent[] = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) {
        continue;
      }
      collectSkillFilesInDir(join(dir, entry.name), depth + 1, found);
      continue;
    }
    if (entry.name.toLowerCase() === "skill.md") {
      found.push(join(dir, entry.name));
    }
  }
}

function collectSkills(root: string, source: "project" | "user", into: Map<string, CatalogEntry>): void {
  for (const dir of skillDirsForRoot(root)) {
    const files: string[] = [];
    collectSkillFilesInDir(dir, 0, files);
    files.sort();
    for (const file of files) {
      const markdown = readFileOrNull(file);
      if (markdown == null) {
        continue;
      }
      const { attrs, body } = splitFrontmatter(markdown);
      const folderName = basename(dirname(file));
      const name = (attrs.name || folderName).trim();
      if (!name) {
        continue;
      }
      const disableModelInvocation = parseBool(attrs["disable-model-invocation"]);
      const icon = (attrs.icon || "").trim();
      const color = (attrs.color || "").trim();
      const item: SlashCatalogItem = {
        kind: "skill",
        id: `skill:${name}`,
        name,
        description: (attrs.description || "").trim(),
        source,
      };
      if (disableModelInvocation !== undefined) {
        item.disableModelInvocation = disableModelInvocation;
      }
      if (icon) {
        item.icon = icon;
      }
      if (color) {
        item.color = color;
      }
      into.set(name.toLowerCase(), { item, body: capBody(body) });
    }
  }
}

/** Scan user dirs first, then project dirs, so the project wins on the same lowercase name. */
function collectCatalogEntries(
  projectRoot: string,
  userHomedir: string,
): { commands: Map<string, CatalogEntry>; skills: Map<string, CatalogEntry> } {
  const commands = new Map<string, CatalogEntry>();
  const skills = new Map<string, CatalogEntry>();
  collectCommands(userHomedir, "user", commands);
  collectCommands(projectRoot, "project", commands);
  collectSkills(userHomedir, "user", skills);
  collectSkills(projectRoot, "project", skills);
  return { commands, skills };
}

function byName(a: SlashCatalogItem, b: SlashCatalogItem): number {
  return a.name.localeCompare(b.name);
}

export function listSlashCatalog(projectRoot: string, userHomedir: string): SlashCatalogItem[] {
  const { commands, skills } = collectCatalogEntries(projectRoot, userHomedir);
  const skillNames = new Set([...skills.keys()]);
  const builtins = CURSOR_BUILTIN_SKILLS.filter((item) => !skillNames.has(item.name.toLowerCase()));
  return [
    ...MODE_SLASH_ITEMS,
    ...WINNOW_SLASH_PRESETS,
    ...builtins,
    ...[...commands.values()].map((entry) => entry.item).sort(byName),
    ...[...skills.values()].map((entry) => entry.item).sort(byName),
  ];
}

function entryById(entries: Map<string, CatalogEntry>, id: string): CatalogEntry | undefined {
  const wanted = id.trim().toLowerCase();
  for (const entry of entries.values()) {
    if (entry.item.id.toLowerCase() === wanted) {
      return entry;
    }
  }
  return undefined;
}

function builtinSlashLine(id: string): string {
  const name = id.slice(id.indexOf(":") + 1).trim();
  if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) {
    return "";
  }
  return `/${name}`;
}

function applyArguments(body: string, userPrompt: string): string {
  if (!body.includes("$ARGUMENTS")) {
    return body;
  }
  return body.split("$ARGUMENTS").join(userPrompt);
}

/**
 * Build the prompt actually sent to the agent: pinned custom-mode skill, then each one-shot
 * command/skill body, then the user's text. Returns the prompt untouched when nothing expands.
 */
export function expandSlashPrompt(opts: {
  projectRoot: string;
  userHomedir: string;
  invocations?: SlashInvocation[];
  /** Skill name (not id) pinned for the session; injected on every turn. */
  customModeSkill?: string;
  userPrompt: string;
}): string {
  const userPrompt = String(opts.userPrompt ?? "");
  const invocations = Array.isArray(opts.invocations) ? opts.invocations : [];
  const pinnedName = String(opts.customModeSkill ?? "").trim();
  if (invocations.length === 0 && !pinnedName) {
    return userPrompt;
  }

  const { commands, skills } = collectCatalogEntries(opts.projectRoot, opts.userHomedir);
  const sections: string[] = [];

  if (pinnedName) {
    const pinned = skills.get(pinnedName.toLowerCase());
    if (pinned && pinned.body.trim()) {
      sections.push(applyArguments(pinned.body, userPrompt));
    }
  }

  for (const invocation of invocations) {
    const id = String(invocation?.id ?? "").trim();
    if (!id) {
      continue;
    }
    if (invocation.kind === "command" || invocation.kind === "skill") {
      const entry = entryById(invocation.kind === "command" ? commands : skills, id);
      if (entry && entry.body.trim()) {
        sections.push(applyArguments(entry.body, userPrompt));
      }
      continue;
    }
    if (invocation.kind === "winnow") {
      const body = WINNOW_PRESET_BODIES[id.toLowerCase()];
      if (body) {
        sections.push(applyArguments(body, userPrompt));
      }
      continue;
    }
    if (invocation.kind === "builtin-skill") {
      const line = builtinSlashLine(id);
      if (line) {
        sections.push(line);
      }
    }
  }

  if (sections.length === 0) {
    return userPrompt;
  }
  return [...sections, userPrompt].filter((section) => section.trim().length > 0).join(SECTION_SEPARATOR);
}
