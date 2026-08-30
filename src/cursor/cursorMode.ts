/**
 * Cursor IDE modes mapped onto `cursor-agent` flags.
 *
 * The CLI only accepts `--mode ask` and `--mode plan` (`--plan` is shorthand for the latter).
 * Agent is the default and has no flag; there is no `--mode agent` and no `--mode debug`.
 */
export type CursorAgentMode = "agent" | "ask" | "plan";

/** `--print` still exposes write and shell tools, so the flag ships with a prompt prefix. */
export const ASK_MODE_PROMPT_PREFIX = [
  "## Mode: Ask (read-only)",
  "",
  "You are answering a question, not changing the workspace.",
  "- Do not create, edit, move, or delete any file.",
  "- Do not run shell commands that mutate state (no installs, no writes, no git commands that change refs or the index).",
  "- Read-only inspection (reading files, searching, listing) is allowed.",
  "- If the answer requires a change, describe the change instead of applying it.",
].join("\n");

export const PLAN_MODE_PROMPT_PREFIX = [
  "## Mode: Plan",
  "",
  "Research first, then propose a plan. Do not implement yet.",
  "- Investigate the codebase and gather the context the change needs.",
  "- Produce a concrete, ordered plan: files to touch, the change in each, risks, and how to verify.",
  "- Do not create, edit, move, or delete any file until the user explicitly asks you to implement the plan.",
].join("\n");

export function normalizeCursorMode(value: unknown): CursorAgentMode {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "ask" || normalized === "plan") {
    return normalized;
  }
  return "agent";
}

/** Drop user-supplied mode flags so the composer picker stays the single source of truth. */
export function stripCursorModeArgs(args: string[]): string[] {
  const stripped: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--mode") {
      if (args[i + 1] !== undefined) {
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("--mode=")) {
      continue;
    }
    if (arg === "--plan") {
      continue;
    }
    stripped.push(arg);
  }
  return stripped;
}

export function ensureCursorModeArg(args: string[], mode: CursorAgentMode): string[] {
  const stripped = stripCursorModeArgs(args);
  if (mode === "ask" || mode === "plan") {
    return [...stripped, "--mode", mode];
  }
  return stripped;
}
