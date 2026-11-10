import { accessSync, constants } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type LivefileLaunch = {
  file: string;
  args: string[];
};

export type LivefileLaunchOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Directories whose sibling `LiveFile/src/cli.js` should be considered. */
  siblingRoots?: string[];
  execPath?: string;
};

const thisFile = fileURLToPath(import.meta.url);

export function winnowPackageRoot(): string {
  return resolve(dirname(thisFile), "../../..");
}

export function resolveLivefileLaunch(options: LivefileLaunchOptions = {}): LivefileLaunch | null {
  const env = options.env ?? process.env;
  const execPath = options.execPath || process.execPath;
  const override = env.WINNOW_LIVEFILE?.trim();
  if (override) {
    return launchFromPath(override, execPath);
  }

  const onPath = findOnPath("livefile", env);
  if (onPath) {
    return { file: onPath, args: [] };
  }

  const roots = options.siblingRoots ?? [options.cwd || process.cwd(), winnowPackageRoot()];
  for (const root of roots) {
    const script = join(root, "..", "LiveFile", "src", "cli.js");
    if (canRead(script)) {
      return { file: execPath, args: [script] };
    }
  }
  return null;
}

function launchFromPath(target: string, execPath: string): LivefileLaunch | null {
  if (!canRead(target)) {
    return null;
  }
  if (target.endsWith(".js") || target.endsWith(".mjs")) {
    return { file: execPath, args: [target] };
  }
  return { file: target, args: [] };
}

function findOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
  const pathValue = env.PATH || env.Path || "";
  const suffixes = process.platform === "win32" ? ["", ".cmd", ".exe", ".bat"] : [""];
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    for (const suffix of suffixes) {
      const candidate = join(dir, name + suffix);
      if (canExecute(candidate)) return candidate;
    }
  }
  return null;
}

function canRead(file: string): boolean {
  try {
    accessSync(file, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function canExecute(file: string): boolean {
  try {
    accessSync(file, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
