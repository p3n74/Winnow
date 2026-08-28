import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectRecord } from "../src/config/projects.js";
import * as diskSnapshot from "../src/data/diskSnapshotService.js";
import {
  buildDiskDashboard,
  clearDiskDashboardCache,
  directorySizeBytes,
} from "../src/data/diskSnapshotService.js";

function project(path: string, name: string): ProjectRecord {
  return { path, name, lastOpened: "2020-01-01T00:00:00.000Z" };
}

async function tinyProject(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(join(dir, "a.txt"), "hello");
  await mkdir(join(dir, "sub"));
  await writeFile(join(dir, "sub", "b.txt"), "world");
  return dir;
}

describe("buildDiskDashboard cache", () => {
  beforeEach(() => {
    clearDiskDashboardCache();
  });

  afterEach(() => {
    clearDiskDashboardCache();
    vi.restoreAllMocks();
  });

  it("walks on the first call and serves the cached snapshot within TTL", async () => {
    const dir = await tinyProject("winnow-disk-hit-");
    const walkSpy = vi.spyOn(diskSnapshot, "directorySizeBytes");
    const listProjects = async () => [project(dir, "tiny")];

    const first = await buildDiskDashboard({
      volumePath: dir,
      listProjects,
      nowMs: 1_000,
      ttlMs: 60_000,
    });
    expect(first.ok).toBe(true);
    expect(first.measuredAt).toBe(new Date(1_000).toISOString());
    expect(first.projects).toHaveLength(1);
    expect(first.projects[0]?.name).toBe("tiny");
    expect(first.projects[0]?.sizeBytes).toBeGreaterThan(0);
    expect(walkSpy).toHaveBeenCalledTimes(1);
    expect(walkSpy).toHaveBeenCalledWith(dir);

    const second = await buildDiskDashboard({
      volumePath: dir,
      listProjects,
      nowMs: 30_000,
      ttlMs: 60_000,
    });
    expect(second).toEqual(first);
    expect(walkSpy).toHaveBeenCalledTimes(1);
  });

  it("walks again after the TTL expires", async () => {
    const dir = await tinyProject("winnow-disk-ttl-");
    const walkSpy = vi.spyOn(diskSnapshot, "directorySizeBytes");
    const listProjects = async () => [project(dir, "tiny")];
    const opts = { volumePath: dir, listProjects, ttlMs: 60_000 };

    await buildDiskDashboard({ ...opts, nowMs: 0 });
    expect(walkSpy).toHaveBeenCalledTimes(1);

    await buildDiskDashboard({ ...opts, nowMs: 59_999 });
    expect(walkSpy).toHaveBeenCalledTimes(1);

    const refreshed = await buildDiskDashboard({ ...opts, nowMs: 60_000 });
    expect(walkSpy).toHaveBeenCalledTimes(2);
    expect(refreshed.measuredAt).toBe(new Date(60_000).toISOString());
  });

  it("walks again when forceRefresh is true even if the TTL is fresh", async () => {
    const dir = await tinyProject("winnow-disk-force-");
    const walkSpy = vi.spyOn(diskSnapshot, "directorySizeBytes");
    const listProjects = async () => [project(dir, "tiny")];

    await buildDiskDashboard({
      volumePath: dir,
      listProjects,
      nowMs: 5_000,
      ttlMs: 60_000,
    });
    expect(walkSpy).toHaveBeenCalledTimes(1);

    const forced = await buildDiskDashboard({
      volumePath: dir,
      listProjects,
      nowMs: 6_000,
      ttlMs: 60_000,
      forceRefresh: true,
    });
    expect(walkSpy).toHaveBeenCalledTimes(2);
    expect(forced.measuredAt).toBe(new Date(6_000).toISOString());
  });

  it("invalidates the cache when the project path set changes", async () => {
    const a = await tinyProject("winnow-disk-a-");
    const b = await tinyProject("winnow-disk-b-");
    const walkSpy = vi.spyOn(diskSnapshot, "directorySizeBytes");

    await buildDiskDashboard({
      volumePath: a,
      listProjects: async () => [project(a, "a")],
      nowMs: 1_000,
      ttlMs: 60_000,
    });
    expect(walkSpy).toHaveBeenCalledTimes(1);

    const withBoth = await buildDiskDashboard({
      volumePath: a,
      listProjects: async () => [project(a, "a"), project(b, "b")],
      nowMs: 2_000,
      ttlMs: 60_000,
    });
    expect(walkSpy).toHaveBeenCalledTimes(3);
    expect(withBoth.projects.map((p) => p.name).sort()).toEqual(["a", "b"]);
  });

  it("does not treat project order as a different set", async () => {
    const a = await tinyProject("winnow-disk-order-a-");
    const b = await tinyProject("winnow-disk-order-b-");
    const walkSpy = vi.spyOn(diskSnapshot, "directorySizeBytes");

    await buildDiskDashboard({
      volumePath: a,
      listProjects: async () => [project(a, "a"), project(b, "b")],
      nowMs: 1_000,
      ttlMs: 60_000,
    });
    expect(walkSpy).toHaveBeenCalledTimes(2);

    await buildDiskDashboard({
      volumePath: a,
      listProjects: async () => [project(b, "b"), project(a, "a")],
      nowMs: 2_000,
      ttlMs: 60_000,
    });
    expect(walkSpy).toHaveBeenCalledTimes(2);
  });

  it("invalidates the cache when the resolved volume path changes", async () => {
    const a = await tinyProject("winnow-disk-vol-a-");
    const b = await tinyProject("winnow-disk-vol-b-");
    const walkSpy = vi.spyOn(diskSnapshot, "directorySizeBytes");
    const listProjects = async () => [project(a, "a")];

    await buildDiskDashboard({
      volumePath: a,
      listProjects,
      nowMs: 1_000,
      ttlMs: 60_000,
    });
    await buildDiskDashboard({
      volumePath: b,
      listProjects,
      nowMs: 2_000,
      ttlMs: 60_000,
    });
    expect(walkSpy).toHaveBeenCalledTimes(2);
  });

  it("returns ok:true with volume.ok false when statfs fails, and caches that snapshot", async () => {
    const missingVolume = join(tmpdir(), "winnow-disk-missing-volume-", String(Date.now()));
    const walkSpy = vi.spyOn(diskSnapshot, "directorySizeBytes");
    const listProjects = async () => [] as ProjectRecord[];

    const first = await buildDiskDashboard({
      volumePath: missingVolume,
      listProjects,
      nowMs: 1_000,
      ttlMs: 60_000,
    });
    expect(first.ok).toBe(true);
    expect(first.volume.ok).toBe(false);
    expect(first.projects).toEqual([]);
    expect(walkSpy).not.toHaveBeenCalled();

    const second = await buildDiskDashboard({
      volumePath: missingVolume,
      listProjects,
      nowMs: 2_000,
      ttlMs: 60_000,
    });
    expect(second).toEqual(first);
  });

  it("still walks registered projects when volume statfs fails, then caches", async () => {
    const dir = await tinyProject("winnow-disk-volfail-");
    const missingVolume = join(tmpdir(), "winnow-disk-no-vol-", String(Date.now()));
    const walkSpy = vi.spyOn(diskSnapshot, "directorySizeBytes");
    const listProjects = async () => [project(dir, "tiny")];

    const first = await buildDiskDashboard({
      volumePath: missingVolume,
      listProjects,
      nowMs: 1_000,
      ttlMs: 60_000,
    });
    expect(first.ok).toBe(true);
    expect(first.volume.ok).toBe(false);
    expect(first.projects).toHaveLength(1);
    expect(walkSpy).toHaveBeenCalledTimes(1);

    await buildDiskDashboard({
      volumePath: missingVolume,
      listProjects,
      nowMs: 2_000,
      ttlMs: 60_000,
    });
    expect(walkSpy).toHaveBeenCalledTimes(1);
  });
});

describe("directorySizeBytes", () => {
  it("sums files in tiny trees and skips missing roots without throwing", async () => {
    const dir = await tinyProject("winnow-disk-size-");
    const sized = await directorySizeBytes(dir);
    expect(sized.truncated).toBe(false);
    expect(sized.filesSeen).toBe(2);
    expect(sized.sizeBytes).toBe(Buffer.byteLength("hello") + Buffer.byteLength("world"));

    const missing = await directorySizeBytes(join(dir, "does-not-exist"));
    expect(missing).toEqual({ sizeBytes: 0, truncated: false, filesSeen: 0 });
  });
});
