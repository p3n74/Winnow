/** Pure helpers for the agent conversation transcript. Kept out of HTML so tests can lock the rules. */

export type ChatLane = "user" | "assistant" | "stderr" | "system" | "trace" | "skip";

export function laneFromTimelineKind(kind: string): ChatLane {
  const k = String(kind || "").toLowerCase();
  if (k === "tool" || k === "status" || k === "system") {
    return "trace";
  }
  if (k === "user") {
    return "user";
  }
  if (k === "assistant") {
    return "assistant";
  }
  if (k === "stderr") {
    return "stderr";
  }
  return "system";
}

export function laneFromHistoryMessage(msg: { role?: string; kind?: string }): ChatLane {
  const role = String(msg.kind || msg.role || "").toLowerCase();
  if (!role || role === "entry") {
    return "skip";
  }
  if (role === "tool" || role === "status" || role === "system") {
    return "trace";
  }
  if (role === "user" || role.includes("user") || role.includes("human")) {
    return "user";
  }
  if (role === "assistant") {
    return "assistant";
  }
  if (role === "stderr" || role.includes("stderr")) {
    return "stderr";
  }
  return "skip";
}

export function shouldSkipDuplicateUser(lastRole: string, lastText: string, incoming: string): boolean {
  if (lastRole !== "user") {
    return false;
  }
  const previous = String(lastText || "");
  const next = String(incoming || "");
  if (!next) {
    return true;
  }
  if (previous === next) {
    return true;
  }
  if (previous && next.startsWith(previous)) {
    return true;
  }
  if (next && previous.startsWith(next)) {
    return true;
  }
  return false;
}

export function shouldReplaceUserText(lastRole: string, lastText: string, incoming: string): boolean {
  if (lastRole !== "user") {
    return false;
  }
  const previous = String(lastText || "");
  const next = String(incoming || "");
  return Boolean(previous && next && next.startsWith(previous) && next.length > previous.length);
}
