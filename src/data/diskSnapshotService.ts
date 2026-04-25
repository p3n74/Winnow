import { readdir, lstat } from "node:fs/promises";
import { statfs } from "node:fs/promises";
import { join } from "node:path";
import { listProjects } from "../config/projects.js";

export type ProjectSizeEntry = {
  path: string;
  name: string;
  sizeBytes: number;
  truncated: boolean;
};

const DEFAULT_SKIP_DIR = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "target",
  ".cache",
  "coverage",
  ".turbo",
  "__pycache__",
  ".venv",
  "vendor",
]);

const MAX_WALK_FILES = 400_000;
const scanBudgetMs = 90_000;

/**
 * Best-effort directory size. Skips heavy/derived dirs for speed; may truncate on huge trees.
 */
export async function directorySizeBytes(
  root: string,
  skipDirNames: Set<string> = DEFAULT_SKIP_DIR,
): Promise<{ sizeBytes: number; truncated: boolean; filesSeen: number }> {
  let total = 0n;
  let count = 0;
  const stack: string[] = [root];
  const t0 = Date.now();
  let truncated = false;
  const maxFiles = MAX_WALK_FILES;

  while (stack.length > 0) {
    if (count > maxFiles) {
      truncated = true;
      break;
    }
    if (Date.now() - t0 > scanBudgetMs) {
      truncated = true;
      break;
    }
    const dir = stack.pop()!;
    let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean; isSymbolicLink: () => boolean }[];
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as typeof entries;
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (count > maxFiles) {
        truncated = true;
        break;
      }
      const n = String(ent.name);
      if (ent.isDirectory()) {
        if (skipDirNames.has(n)) {
          continue;
        }
        stack.push(join(dir, n));
        continue;
      }
      if (!ent.isFile() && !ent.isSymbolicLink()) {
        continue;
      }
      const p = join(dir, n);
      try {
        const st = await lstat(p);
        if (st.isFile()) {
          total += BigInt(st.size);
          count++;
        }
      } catch {
        // ignore
      }
    }
  }

  const cap = BigInt(Number.MAX_SAFE_INTEGER);
  const sizeN = total > cap ? cap : total;
  return { sizeBytes: Number(sizeN), truncated, filesSeen: count };
}

export type VolumeStats = {
  path: string;
  freeBytes: number;
  totalBytes: number;
  ok: boolean;
  error?: string;
};

function bn(v: bigint | number | undefined | null): number {
  if (v === undefined || v === null) {
    return 0;
  }
  if (typeof v === "bigint") {
    return v > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(v);
  }
  if (Number.isFinite(v)) {
    return v;
  }
  return 0;
}

/** Free/ total bytes for the volume containing `path` (Node 20+). */
export async function volumeBytesForPath(rootPath: string): Promise<VolumeStats> {
  try {
    const s = await statfs(rootPath);
    const bsize = bn(s.bsize) || 1;
    const bavail = bn(s.bavail);
    const blocks = bn(s.blocks);
    if (bsize <= 0) {
      return { path: rootPath, freeBytes: 0, totalBytes: 0, ok: false, error: "invalid_statfs" };
    }
    const freeBytes = bavail * bsize;
    const totalBytes = Math.max(0, blocks * bsize);
    return { path: rootPath, freeBytes, totalBytes, ok: true };
  } catch (e) {
    return {
      path: rootPath,
      freeBytes: 0,
      totalBytes: 0,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Current disk usage for the workspace volume and per registered project (latest measurement only; not persisted).
 */
export async function buildDiskDashboard(opts: { volumePath: string }): Promise<{
  ok: boolean;
  volume: VolumeStats;
  projects: ProjectSizeEntry[];
  measuredAt: string;
  note?: string;
}> {
  const vol = await volumeBytesForPath(opts.volumePath);
  const projects = await listProjects();
  const sizes: ProjectSizeEntry[] = [];
  for (const p of projects) {
    const { sizeBytes, truncated } = await directorySizeBytes(p.path);
    sizes.push({ path: p.path, name: p.name, sizeBytes, truncated });
  }

  return {
    ok: true,
    volume: vol,
    projects: sizes,
    measuredAt: new Date().toISOString(),
    note: sizes.some((s) => s.truncated)
      ? "Some project sizes are estimates (very large trees are capped or time-limited; common vendor dirs are skipped)."
      : undefined,
  };
}
