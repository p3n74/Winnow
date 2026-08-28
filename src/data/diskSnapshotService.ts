import { readdir, lstat } from "node:fs/promises";
import { statfs } from "node:fs/promises";
import { join, resolve } from "node:path";
import { listProjects as listProjectsFromRegistry } from "../config/projects.js";
import type { ProjectRecord } from "../config/projects.js";
/** Same-module namespace so tests can `spyOn(module, "directorySizeBytes")`. */
import * as diskSnapshotService from "./diskSnapshotService.js";

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

/** Default freshness window for the in-memory dashboard snapshot. */
export const DISK_DASHBOARD_TTL_MS = 60_000;

export type DiskDashboard = {
  ok: boolean;
  volume: VolumeStats;
  projects: ProjectSizeEntry[];
  measuredAt: string;
  note?: string;
};

export type BuildDiskDashboardOpts = {
  volumePath: string;
  listProjects?: () => Promise<ProjectRecord[]>;
  forceRefresh?: boolean;
  nowMs?: number;
  ttlMs?: number;
};

type DiskDashboardCache = {
  measuredAtMs: number;
  volumePath: string;
  projectPathsKey: string;
  snapshot: DiskDashboard;
};

let cache: DiskDashboardCache | null = null;

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

function projectPathsKey(projects: ProjectRecord[]): string {
  return [...new Set(projects.map((p) => resolve(p.path)))].sort().join("\n");
}

export function clearDiskDashboardCache(): void {
  cache = null;
}

/**
 * Current disk usage for the workspace volume and per registered project (latest measurement only; not persisted).
 * Returns a cached snapshot when the TTL has not expired and the resolved volume + project path set are unchanged.
 */
export async function buildDiskDashboard(opts: BuildDiskDashboardOpts): Promise<DiskDashboard> {
  const nowMs = opts.nowMs ?? Date.now();
  const ttlMs = opts.ttlMs ?? DISK_DASHBOARD_TTL_MS;
  const forceRefresh = opts.forceRefresh === true;
  const listProjects = opts.listProjects ?? listProjectsFromRegistry;
  const resolvedVolume = resolve(opts.volumePath);
  const projects = await listProjects();
  const pathsKey = projectPathsKey(projects);

  if (
    !forceRefresh &&
    cache &&
    nowMs - cache.measuredAtMs < ttlMs &&
    cache.volumePath === resolvedVolume &&
    cache.projectPathsKey === pathsKey
  ) {
    return cache.snapshot;
  }

  try {
    const vol = await volumeBytesForPath(opts.volumePath);
    const sizes: ProjectSizeEntry[] = [];
    for (const p of projects) {
      const { sizeBytes, truncated } = await diskSnapshotService.directorySizeBytes(p.path);
      sizes.push({ path: p.path, name: p.name, sizeBytes, truncated });
    }

    const snapshot: DiskDashboard = {
      ok: true,
      volume: vol,
      projects: sizes,
      measuredAt: new Date(nowMs).toISOString(),
      note: sizes.some((s) => s.truncated)
        ? "Some project sizes are estimates (very large trees are capped or time-limited; common vendor dirs are skipped)."
        : undefined,
    };

    cache = {
      measuredAtMs: nowMs,
      volumePath: resolvedVolume,
      projectPathsKey: pathsKey,
      snapshot,
    };
    return snapshot;
  } catch (error) {
    // Do not cache hard failures (thrown walks / unexpected errors) so a retry can recover.
    throw error;
  }
}
