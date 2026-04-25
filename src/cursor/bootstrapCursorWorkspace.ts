import { mkdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Ensure a minimal `.cursor` layout exists so Cursor / cursor-agent treats the
 * folder like a normal workspace (similar to opening a new directory in the IDE).
 */
export async function ensureCursorWorkspaceLayout(projectRoot: string): Promise<void> {
  await mkdir(join(projectRoot, ".cursor"), { recursive: true });
  await mkdir(join(projectRoot, ".cursor", "rules"), { recursive: true });
}

export function ensureCursorWorkspaceLayoutSync(projectRoot: string): void {
  mkdirSync(join(projectRoot, ".cursor"), { recursive: true });
  mkdirSync(join(projectRoot, ".cursor", "rules"), { recursive: true });
}
