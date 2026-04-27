import Database from "better-sqlite3";
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

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(input: string): string {
  const cleaned = String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned || `plan-${Date.now()}`;
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
    const idBase = slugify(title);
    let id = idBase;
    let i = 1;
    while (this.get(id)) {
      i += 1;
      id = `${idBase}-${i}`;
    }
    const mdPath = join(this.plansDir, `${id}.md`);
    const createdAt = nowIso();
    const markdown = String(input.markdown || "").trim()
      ? String(input.markdown)
      : `# ${title}\n\n## Goal\n\n- TODO\n\n## Tasks\n\n- [ ] Define scope\n- [ ] Implement\n- [ ] Validate\n`;
    writeFileSync(mdPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
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
    if (input.markdown !== undefined) {
      const md = String(input.markdown ?? "");
      writeFileSync(cur.mdPath, md.endsWith("\n") ? md : `${md}\n`, "utf8");
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
      if (headingTitle && headingTitle !== row.title && this.db) {
        const ts = nowIso();
        this.db.prepare(`UPDATE plans SET title = ?, updated_at = ? WHERE id = ?`).run(headingTitle, ts, id);
        return { ok: true, id: row.id, title: headingTitle, markdown };
      }
      return { ok: true, id: row.id, title: row.title, markdown };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
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
