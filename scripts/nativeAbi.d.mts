export const NATIVE_PACKAGES: readonly ["better-sqlite3", "node-pty"];

export function isNativeAbiMismatch(output: unknown): boolean;

export function pathWithRunningNode(
  envPath: string | undefined,
  execPath: string,
  pathDelimiter: string,
): string;
