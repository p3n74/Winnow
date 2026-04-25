import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { rebuildAndWriteProjectDocsIndex, resolveDocFilePath } from "../src/cli/projectDocsIndex.js";

describe("resolveDocFilePath", () => {
  it("resolves a normal markdown path under the project root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winnow-docs-"));
    const abs = resolveDocFilePath(dir, "docs/readme.md");
    expect(abs).toBe(join(dir, "docs/readme.md"));
  });

  it("rejects path traversal", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winnow-docs-"));
    expect(() => resolveDocFilePath(dir, "../outside.md")).toThrow();
  });
});

describe("rebuildAndWriteProjectDocsIndex", () => {
  it("writes an index including md and pdf files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winnow-docs-"));
    await mkdir(join(dir, "a"), { recursive: true });
    await writeFile(join(dir, "a", "x.md"), "# hi\n", "utf8");
    await writeFile(join(dir, "b.pdf"), "%PDF-1.4\n", "utf8");
    const idx = await rebuildAndWriteProjectDocsIndex(dir);
    expect(idx.files.length).toBe(2);
    expect(idx.files.some((f) => f.relPath === "a/x.md" && f.kind === "md")).toBe(true);
    expect(idx.files.some((f) => f.relPath === "b.pdf" && f.kind === "pdf")).toBe(true);
  });
});
