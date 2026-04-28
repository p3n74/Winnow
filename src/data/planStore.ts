import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export type PlanRecord = {
  id: string;
  title: string;
  status: "draft" | "active" | "blocked" | "done";
  mdPath: string;
  createdAt: string;
  updatedAt: string;
};

export type PlanTaskMapping = {
  planId: string;
  taskKey: string;
  issueRef: string | null; // e.g. "owner/repo#123"
  issueUrl: string | null;
  issueState: string | null; // open | closed | null
  updatedAt: string;
};

export type PlanTaskNode = {
  // Stable key derived from section + indentation + label (slugified).
  key: string;
  section: string;
  label: string;
  done: boolean;
  indentLevels: number;
  optional: boolean; // true when nested under another task (sidequest)
  lineIndex: number;
  mapping: PlanTaskMapping | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function applyTitleToMarkdownHeading(markdown: string, title: string): string {
  const nextTitle = String(title || "").trim();
  if (!nextTitle) {
    return markdown;
  }
  const source = String(markdown || "");
  const lines = source.split(/\r?\n/);
  const firstHeadingIdx = lines.findIndex((line) => /^#\s+/.test(String(line || "")));
  if (firstHeadingIdx >= 0) {
    lines[firstHeadingIdx] = `# ${nextTitle}`;
    return lines.join("\n");
  }
  const normalized = source.trim();
  return normalized.length > 0 ? `# ${nextTitle}\n\n${normalized}` : `# ${nextTitle}\n`;
}

function canonicalSectionKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizePlanMarkdown(markdown: string, title: string): string {
  const source = String(markdown || "").replace(/\r/g, "");
  const lines = source.split("\n");
  const requestedTitle = String(title || "").trim();
  const existingTitle =
    lines
      .map((line) => String(line || "").trim())
      .find((line) => line.startsWith("# "))
      ?.replace(/^#\s+/, "")
      .trim() || "";
  const topTitle = requestedTitle || existingTitle || "Untitled plan";

  const knownSections = new Map<string, string>();
  let activeSection = "";
  const sectionLines = new Map<string, string[]>();
  for (const rawLine of lines) {
    const line = String(rawLine || "");
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      activeSection = canonicalSectionKey(h2[1]);
      if (!sectionLines.has(activeSection)) {
        sectionLines.set(activeSection, []);
      }
      continue;
    }
    if (activeSection) {
      sectionLines.get(activeSection)?.push(line);
    }
  }

  const readSection = (aliases: string[]): string => {
    for (const alias of aliases) {
      const key = canonicalSectionKey(alias);
      if (sectionLines.has(key)) {
        knownSections.set(alias, key);
        const value = (sectionLines.get(key) || []).join("\n").trim();
        if (value.length > 0) return value;
      }
    }
    return "";
  };

  const goal = readSection(["Goal", "Objectives", "Objective"]);
  const scope = readSection(["Current Scope", "Scope"]);
  const completed = readSection(["Completed", "Done"]);
  const inProgress = readSection(["In Progress", "In-Progress", "Active"]);
  const nextTasks = readSection(["Next Tasks", "Tasks", "Next Steps"]);
  const validation = readSection(["Validation Checklist", "Validation", "Checks"]);
  const notes = readSection(["Notes"]);

  const ensureChecklist = (value: string, fallbackLine: string): string => {
    const v = String(value || "");
    if (!v.trim()) return `- [ ] ${fallbackLine}`;
    const rawLines = v.split("\n");
    // Preserve leading indentation so nested sidequest subtrees (e.g. "  - [ ] ...")
    // remain attached to their parent task in the canonical markdown.
    const out: string[] = [];
    for (const rawLine of rawLines) {
      const line = String(rawLine || "");
      if (!line.trim()) continue;
      const indentMatch = line.match(/^(\s*)(.*)$/);
      const indent = indentMatch ? indentMatch[1].replace(/\t/g, "  ") : "";
      const rest = indentMatch ? indentMatch[2] : line.trim();
      if (/^-\s+\[( |x|X)\]\s+/.test(rest)) {
        out.push(`${indent}${rest}`);
      } else {
        const stripped = rest.replace(/^-+\s*/, "");
        out.push(`${indent}- [ ] ${stripped}`);
      }
    }
    return out.length > 0 ? out.join("\n") : `- [ ] ${fallbackLine}`;
  };

  const parts = [
    `# ${topTitle}`,
    "",
    "## Goal",
    "",
    goal || "- Build and maintain a clear, executable plan.",
    "",
    "## Completed",
    "",
    ensureChecklist(completed, "Document completed work."),
    "",
    "## In Progress",
    "",
    ensureChecklist(inProgress, "Track active work."),
    "",
    "## Next Tasks",
    "",
    ensureChecklist(nextTasks, "Define the next implementation step."),
    "",
    "## Validation Checklist",
    "",
    ensureChecklist(validation, "Confirm behavior with a concrete test."),
    "",
    "## Current Scope",
    "",
    scope || "- [ ] Define current implementation scope.",
    "",
    "## Notes",
    "",
    notes ||
      "- Keep graph-oriented structure: root plan -> sections -> primary tasks -> nested sidequests.\n" +
        "- Sidequests attach to a parent task via nested checklist indentation, not a separate section.",
    "",
  ];
  return parts.join("\n");
}

function taskKeyFor(section: string, indentLevels: number, label: string, occurrence: number): string {
  const sectionSlug = canonicalSectionKey(section).replace(/\s+/g, "-") || "root";
  const labelSlug = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "task";
  return `${sectionSlug}/${indentLevels}/${labelSlug}${occurrence > 1 ? `~${occurrence}` : ""}`;
}

export function parseTasksFromMarkdown(markdown: string): Omit<PlanTaskNode, "mapping">[] {
  const source = String(markdown || "").replace(/\r/g, "");
  const lines = source.split("\n");
  let activeSection = "";
  const taskStack: { indentLevels: number }[] = [];
  const seen = new Map<string, number>();
  const tasks: Omit<PlanTaskNode, "mapping">[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || "";
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      activeSection = h2[1].trim();
      taskStack.length = 0;
      continue;
    }
    const m = line.match(/^(\s*)-\s+\[( |x|X)\]\s+(.+)$/);
    if (!m) continue;
    const indent = String(m[1] || "").replace(/\t/g, "  ").length;
    const indentLevels = Math.floor(indent / 2);
    const done = String(m[2] || "").toLowerCase() === "x";
    // Strip any inline GitHub mapping comment from the visible label.
    const rawLabel = String(m[3] || "").replace(/\s*<!--\s*gh:[^>]*-->\s*$/, "").trim();
    while (taskStack.length > 0 && taskStack[taskStack.length - 1].indentLevels >= indentLevels) {
      taskStack.pop();
    }
    const optional = taskStack.length > 0;
    taskStack.push({ indentLevels });
    const baseKey = taskKeyFor(activeSection, indentLevels, rawLabel, 1);
    const occ = (seen.get(baseKey) || 0) + 1;
    seen.set(baseKey, occ);
    const key = taskKeyFor(activeSection, indentLevels, rawLabel, occ);
    tasks.push({
      key,
      section: activeSection,
      label: rawLabel,
      done,
      indentLevels,
      optional,
      lineIndex: i,
    });
  }
  return tasks;
}

export class PlanStore {
  private readonly projectRoot: string;
  private readonly plansDir: string;
  private readonly dbPath: string;
  private db: InstanceType<typeof Database> | null = null;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
    this.plansDir = join(this.projectRoot, ".winnow", "plans");
    this.dbPath = join(this.projectRoot, ".winnow", "winnow.db");
  }

  init(): void {
    if (this.db) return;
    mkdirSync(this.plansDir, { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id           TEXT PRIMARY KEY,
        title        TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'draft',
        md_path      TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_plans_updated_at ON plans(updated_at);
      CREATE TABLE IF NOT EXISTS plan_task_mappings (
        plan_id      TEXT NOT NULL,
        task_key     TEXT NOT NULL,
        issue_ref    TEXT,
        issue_url    TEXT,
        issue_state  TEXT,
        updated_at   TEXT NOT NULL,
        PRIMARY KEY (plan_id, task_key)
      );
      CREATE INDEX IF NOT EXISTS idx_plan_task_mappings_plan ON plan_task_mappings(plan_id);
    `);
  }

  list(): PlanRecord[] {
    if (!this.db) return [];
    const rows = this.db
      .prepare(
        `SELECT id, title, status, md_path AS mdPath, created_at AS createdAt, updated_at AS updatedAt
         FROM plans ORDER BY updated_at DESC`,
      )
      .all() as PlanRecord[];
    return rows;
  }

  get(id: string): PlanRecord | null {
    if (!this.db) return null;
    const row = this.db
      .prepare(
        `SELECT id, title, status, md_path AS mdPath, created_at AS createdAt, updated_at AS updatedAt
         FROM plans WHERE id = ?`,
      )
      .get(id) as PlanRecord | undefined;
    return row ?? null;
  }

  create(input: {
    title: string;
    markdown?: string;
    status?: "draft" | "active" | "blocked" | "done";
  }): PlanRecord {
    if (!this.db) {
      throw new Error("plan store not initialized");
    }
    const title = String(input.title || "").trim() || "Untitled plan";
    let id = randomUUID();
    while (this.get(id)) {
      id = randomUUID();
    }
    const mdPath = join(this.plansDir, `${id}.md`);
    const createdAt = nowIso();
    const markdown = String(input.markdown || "").trim()
      ? String(input.markdown)
      : `# ${title}\n\n## Goal\n\n- TODO\n\n## Tasks\n\n- [ ] Define scope\n- [ ] Implement\n- [ ] Validate\n`;
    const normalized = normalizePlanMarkdown(markdown, title);
    writeFileSync(mdPath, normalized.endsWith("\n") ? normalized : `${normalized}\n`, "utf8");
    const row: PlanRecord = {
      id,
      title,
      status: input.status ?? "draft",
      mdPath,
      createdAt,
      updatedAt: createdAt,
    };
    this.db
      .prepare(
        `INSERT INTO plans (id, title, status, md_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.title, row.status, row.mdPath, row.createdAt, row.updatedAt);
    return row;
  }

  save(
    id: string,
    input: {
      title?: string;
      status?: "draft" | "active" | "blocked" | "done";
      markdown?: string;
    },
  ): PlanRecord {
    if (!this.db) {
      throw new Error("plan store not initialized");
    }
    const cur = this.get(id);
    if (!cur) {
      throw new Error(`plan not found: ${id}`);
    }
    const nextTitle = String(input.title || "").trim() || cur.title;
    const nextStatus = input.status ?? cur.status;
    const nextUpdatedAt = nowIso();
    const shouldUpdateTitle = typeof input.title === "string" && String(input.title).trim().length > 0;
    if (input.markdown !== undefined) {
      const md = shouldUpdateTitle
        ? applyTitleToMarkdownHeading(String(input.markdown ?? ""), nextTitle)
        : String(input.markdown ?? "");
      const normalized = normalizePlanMarkdown(md, nextTitle);
      writeFileSync(cur.mdPath, normalized.endsWith("\n") ? normalized : `${normalized}\n`, "utf8");
    } else if (shouldUpdateTitle) {
      const existing = readFileSync(cur.mdPath, "utf8");
      const patched = applyTitleToMarkdownHeading(existing, nextTitle);
      const normalized = normalizePlanMarkdown(patched, nextTitle);
      writeFileSync(cur.mdPath, normalized.endsWith("\n") ? normalized : `${normalized}\n`, "utf8");
    }
    this.db
      .prepare(`UPDATE plans SET title = ?, status = ?, updated_at = ? WHERE id = ?`)
      .run(nextTitle, nextStatus, nextUpdatedAt, id);
    return {
      ...cur,
      title: nextTitle,
      status: nextStatus,
      updatedAt: nextUpdatedAt,
    };
  }

  normalize(id: string): PlanRecord {
    if (!this.db) {
      throw new Error("plan store not initialized");
    }
    const cur = this.get(id);
    if (!cur) {
      throw new Error(`plan not found: ${id}`);
    }
    const existing = readFileSync(cur.mdPath, "utf8");
    const normalized = normalizePlanMarkdown(existing, cur.title);
    const nextContent = normalized.endsWith("\n") ? normalized : `${normalized}\n`;
    const prevContent = existing.endsWith("\n") ? existing : `${existing}\n`;
    if (nextContent === prevContent) {
      return cur;
    }
    writeFileSync(cur.mdPath, nextContent, "utf8");
    const nextUpdatedAt = nowIso();
    this.db.prepare(`UPDATE plans SET updated_at = ? WHERE id = ?`).run(nextUpdatedAt, id);
    return {
      ...cur,
      updatedAt: nextUpdatedAt,
    };
  }

  readMarkdown(id: string): { ok: true; id: string; title: string; markdown: string } | { ok: false; error: string } {
    const row = this.get(id);
    if (!row) {
      return { ok: false, error: "plan not found" };
    }
    try {
      const markdown = readFileSync(row.mdPath, "utf8");
      const headingTitle =
        markdown
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l.startsWith("# "))
          ?.replace(/^#\s+/, "")
          ?.trim() || row.title;
      // Read path is intentionally side-effect free.
      return { ok: true, id: row.id, title: headingTitle || row.title, markdown };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  listTasks(planId: string): PlanTaskNode[] {
    const cur = this.get(planId);
    if (!cur) return [];
    let markdown = "";
    try {
      markdown = readFileSync(cur.mdPath, "utf8");
    } catch {
      return [];
    }
    const tasks = parseTasksFromMarkdown(markdown);
    const mappings = this.listTaskMappings(planId);
    const byKey = new Map(mappings.map((m) => [m.taskKey, m]));
    return tasks.map((t) => ({ ...t, mapping: byKey.get(t.key) ?? null }));
  }

  listTaskMappings(planId: string): PlanTaskMapping[] {
    if (!this.db) return [];
    const rows = this.db
      .prepare(
        `SELECT plan_id AS planId, task_key AS taskKey, issue_ref AS issueRef,
                issue_url AS issueUrl, issue_state AS issueState, updated_at AS updatedAt
         FROM plan_task_mappings WHERE plan_id = ?`,
      )
      .all(planId) as PlanTaskMapping[];
    return rows;
  }

  setTaskMapping(
    planId: string,
    taskKey: string,
    input: { issueRef?: string | null; issueUrl?: string | null; issueState?: string | null },
  ): PlanTaskMapping {
    if (!this.db) {
      throw new Error("plan store not initialized");
    }
    if (!this.get(planId)) {
      throw new Error(`plan not found: ${planId}`);
    }
    const updatedAt = nowIso();
    const issueRef = input.issueRef ? String(input.issueRef).trim() : null;
    const issueUrl = input.issueUrl ? String(input.issueUrl).trim() : null;
    const issueState = input.issueState ? String(input.issueState).trim() : null;
    if (!issueRef && !issueUrl && !issueState) {
      this.db
        .prepare(`DELETE FROM plan_task_mappings WHERE plan_id = ? AND task_key = ?`)
        .run(planId, taskKey);
      return { planId, taskKey, issueRef: null, issueUrl: null, issueState: null, updatedAt };
    }
    this.db
      .prepare(
        `INSERT INTO plan_task_mappings (plan_id, task_key, issue_ref, issue_url, issue_state, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(plan_id, task_key) DO UPDATE SET
           issue_ref = excluded.issue_ref,
           issue_url = excluded.issue_url,
           issue_state = excluded.issue_state,
           updated_at = excluded.updated_at`,
      )
      .run(planId, taskKey, issueRef, issueUrl, issueState, updatedAt);
    return { planId, taskKey, issueRef, issueUrl, issueState, updatedAt };
  }

  async backfillFromMarkdownFiles(): Promise<void> {
    if (!this.db) return;
    const names = await readdir(this.plansDir).catch(() => []);
    for (const name of names) {
      if (!name.toLowerCase().endsWith(".md")) continue;
      const id = basename(name, ".md");
      if (this.get(id)) continue;
      const abs = join(this.plansDir, name);
      const text = readFileSync(abs, "utf8");
      const title = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.startsWith("# "))
        ?.replace(/^#\s+/, "")
        ?.trim() || id;
      const st = await stat(abs);
      const ts = st.mtime.toISOString();
      this.db
        .prepare(`INSERT INTO plans (id, title, status, md_path, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?, ?)`)
        .run(id, title, abs, ts, ts);
    }
  }
}
