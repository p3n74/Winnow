import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  buildAttachmentPromptBlock,
  resolveStoredAttachments,
  saveAttachment,
} from "../src/cursor/attachments.js";

/** 1x1 PNG */
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const dirs: string[] = [];

async function tempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "winnow-attach-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("saveAttachment", () => {
  it("writes <uuid>.png and roundtrips bytes", async () => {
    const root = await tempWorkspace();
    const saved = await saveAttachment(root, { mime: "image/png", dataBase64: TINY_PNG_B64 });
    expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(basename(saved.absPath)).toBe(`${saved.id}.png`);
    expect(saved.relPath).toBe(join(".winnow", "attachments", `${saved.id}.png`));
    expect(saved.absPath.startsWith(join(root, ".winnow", "attachments"))).toBe(true);
    const onDisk = await readFile(saved.absPath);
    expect(onDisk.equals(Buffer.from(TINY_PNG_B64, "base64"))).toBe(true);
    expect(saved.bytes).toBe(onDisk.length);
  });

  it("strips a data URL prefix before writing", async () => {
    const root = await tempWorkspace();
    const saved = await saveAttachment(root, {
      mime: "image/png",
      dataBase64: `data:image/png;base64,${TINY_PNG_B64}`,
    });
    const onDisk = await readFile(saved.absPath);
    expect(onDisk.equals(Buffer.from(TINY_PNG_B64, "base64"))).toBe(true);
  });

  it("rejects mime text/plain", async () => {
    const root = await tempWorkspace();
    await expect(saveAttachment(root, { mime: "text/plain", dataBase64: TINY_PNG_B64 })).rejects.toThrow(
      /unsupported image type/i,
    );
  });

  it("rejects oversize payloads", async () => {
    const root = await tempWorkspace();
    await expect(
      saveAttachment(root, { mime: "image/png", dataBase64: TINY_PNG_B64 }, { maxBytes: 1 }),
    ).rejects.toThrow(/too large/i);
    expect(MAX_ATTACHMENT_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe("resolveStoredAttachments", () => {
  it("rejects ids that contain ..", () => {
    expect(() => resolveStoredAttachments("/tmp/workspace", ["../secret"])).toThrow(/invalid attachment id/i);
  });

  it("rejects ids with slashes and ignores missing files", async () => {
    const root = await tempWorkspace();
    expect(() => resolveStoredAttachments(root, ["foo/bar"])).toThrow(/invalid attachment id/i);
    expect(resolveStoredAttachments(root, ["00000000-0000-0000-0000-000000000000"])).toEqual([]);
  });

  it("returns existing files by uuid stem", async () => {
    const root = await tempWorkspace();
    const saved = await saveAttachment(root, { mime: "image/png", dataBase64: TINY_PNG_B64 });
    expect(resolveStoredAttachments(root, [saved.id])).toEqual([{ absPath: saved.absPath, id: saved.id }]);
  });
});

describe("buildAttachmentPromptBlock", () => {
  it("includes abs paths and heading ## Attached files", () => {
    const block = buildAttachmentPromptBlock(["/abs/path.png", "/tmp/shot.jpg"]);
    expect(block).toContain("## Attached files");
    expect(block).toContain("Read these paths with your file tools (screenshots for this task):");
    expect(block).toContain("- /abs/path.png");
    expect(block).toContain("- /tmp/shot.jpg");
  });

  it("returns an empty string for empty paths", () => {
    expect(buildAttachmentPromptBlock([])).toBe("");
  });
});
