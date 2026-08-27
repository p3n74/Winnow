import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";

export const ALLOWED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number];

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_SEND = 8;

export type SaveAttachmentInput = {
  mime: string;
  dataBase64: string;
};

export type SavedAttachment = {
  id: string;
  relPath: string;
  absPath: string;
  bytes: number;
};

export type ResolvedAttachment = {
  absPath: string;
  id: string;
};

export function attachmentDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".winnow", "attachments");
}

export function extForMime(mime: string): string {
  const normalized = mime.trim().toLowerCase();
  if (normalized === "image/png") {
    return "png";
  }
  if (normalized === "image/jpeg") {
    return "jpg";
  }
  if (normalized === "image/webp") {
    return "webp";
  }
  if (normalized === "image/gif") {
    return "gif";
  }
  throw new Error(`unsupported image type: ${mime}`);
}

function isAllowedMime(mime: string): mime is AllowedImageMime {
  const normalized = mime.trim().toLowerCase();
  return (ALLOWED_IMAGE_MIMES as readonly string[]).includes(normalized);
}

function decodeBase64Payload(dataBase64: string): Buffer {
  const trimmed = dataBase64.trim();
  if (!trimmed) {
    throw new Error("empty attachment data");
  }
  const payload =
    /^data:/i.test(trimmed) && trimmed.includes(",")
      ? trimmed.slice(trimmed.indexOf(",") + 1)
      : trimmed;
  if (!payload.trim()) {
    throw new Error("empty attachment data");
  }
  const buf = Buffer.from(payload, "base64");
  if (buf.length === 0) {
    throw new Error("empty attachment data");
  }
  return buf;
}

function assertInsideDir(dir: string, absPath: string): void {
  const root = resolve(dir);
  const target = resolve(absPath);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("path escape: attachment must stay under .winnow/attachments");
  }
}

function assertSafeAttachmentId(id: string): void {
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) {
    throw new Error("invalid attachment id");
  }
}

export async function saveAttachment(
  workspaceRoot: string,
  input: SaveAttachmentInput,
  options?: { maxBytes?: number },
): Promise<SavedAttachment> {
  const mime = String(input.mime ?? "").trim();
  if (!isAllowedMime(mime)) {
    throw new Error(`unsupported image type: ${mime || "(empty)"}`);
  }
  const data = decodeBase64Payload(String(input.dataBase64 ?? ""));
  const maxBytes = options?.maxBytes ?? MAX_ATTACHMENT_BYTES;
  if (data.length > maxBytes) {
    throw new Error(`attachment too large: ${data.length} bytes (max ${maxBytes})`);
  }
  const id = randomUUID();
  const ext = extForMime(mime);
  const dir = attachmentDir(workspaceRoot);
  await mkdir(dir, { recursive: true });
  const filename = `${id}.${ext}`;
  const absPath = resolve(dir, filename);
  assertInsideDir(dir, absPath);
  await writeFile(absPath, data);
  return {
    id,
    relPath: join(".winnow", "attachments", filename),
    absPath,
    bytes: data.length,
  };
}

export function resolveStoredAttachments(
  workspaceRoot: string,
  ids: string[],
): ResolvedAttachment[] {
  const dir = resolve(attachmentDir(workspaceRoot));
  const out: ResolvedAttachment[] = [];
  for (const rawId of ids) {
    const id = String(rawId ?? "");
    assertSafeAttachmentId(id);
    const exts = ["png", "jpg", "jpeg", "webp", "gif"] as const;
    let absPath = "";
    for (const ext of exts) {
      const candidate = resolve(dir, `${id}.${ext}`);
      try {
        assertInsideDir(dir, candidate);
      } catch {
        continue;
      }
      if (existsSync(candidate)) {
        absPath = candidate;
        break;
      }
    }
    if (!absPath) {
      continue;
    }
    out.push({ absPath, id });
  }
  return out;
}

export function buildAttachmentPromptBlock(absPaths: string[]): string {
  if (absPaths.length === 0) {
    return "";
  }
  const bullets = absPaths.map((path) => `- ${path}`).join("\n");
  return `## Attached files\nRead these paths with your file tools (screenshots for this task):\n${bullets}`;
}
