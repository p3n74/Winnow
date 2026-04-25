import { mkdir, opendir, readFile, stat, writeFile } from "node:fs/promises";
import { join, normalize, relative, resolve, sep } from "node:path";

export type DocsIndexEntry = {
  relPath: string;
  kind: "md" | "pdf";
  size: number;
};

export type DocsIndex = {
  scannedAt: string;
  root: string;
  files: DocsIndexEntry[];
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
]);

export function projectDocsIndexPath(projectRoot: string): string {
  return join(resolve(projectRoot), ".winnow", "docs-index.json");
}

/** Resolve a workspace-relative doc path; rejects traversal outside project root. */
export function resolveDocFilePath(projectRoot: string, relPath: string): string {
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
  const lower = abs.toLowerCase();
  if (!lower.endsWith(".md") && !lower.endsWith(".pdf")) {
    throw new Error("only .md and .pdf files are allowed");
  }
  return abs;
}

async function walkMarkdownAndPdf(projectRoot: string): Promise<DocsIndexEntry[]> {
  const root = resolve(projectRoot);
  const out: DocsIndexEntry[] = [];

  async function walk(absDir: string): Promise<void> {
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
        await walk(abs);
      } else if (ent.isFile()) {
        const lower = ent.name.toLowerCase();
        if (!lower.endsWith(".md") && !lower.endsWith(".pdf")) {
          continue;
        }
        const st = await stat(abs).catch(() => null);
        if (!st) {
          continue;
        }
        const rel = relative(root, abs).split(sep).join("/");
        if (rel.startsWith("..")) {
          continue;
        }
        out.push({
          relPath: rel,
          kind: lower.endsWith(".pdf") ? "pdf" : "md",
          size: st.size,
        });
      }
    }
  }

  await walk(root);
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

export async function rebuildAndWriteProjectDocsIndex(projectRoot: string): Promise<DocsIndex> {
  const root = resolve(projectRoot);
  await mkdir(join(root, ".winnow"), { recursive: true });
  const files = await walkMarkdownAndPdf(root);
  const index: DocsIndex = {
    scannedAt: new Date().toISOString(),
    root,
    files,
  };
  await writeFile(projectDocsIndexPath(root), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}

export async function readProjectDocsIndex(projectRoot: string): Promise<DocsIndex | null> {
  try {
    const raw = await readFile(projectDocsIndexPath(projectRoot), "utf8");
    const parsed = JSON.parse(raw) as DocsIndex;
    if (!parsed || !Array.isArray(parsed.files)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
