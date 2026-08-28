import type { AgentSession } from "./types.js";

export const MAX_SESSION_OUTPUT_CHARS = 512_000;
export const SESSION_CLIENT_EVENT_LIMIT = 500;
export const MAX_LIVE_SESSIONS = 32;
export const MAX_STDOUT_LINE_BUFFER = 1_000_000;
export const MAX_CONCURRENT_AGENT_RUNS = 3;

export type AgentStartBlockedCode = "session_running" | "concurrent_cap";

export class AgentStartBlockedError extends Error {
  readonly status: number;
  readonly code: AgentStartBlockedCode;

  constructor(status: number, code: AgentStartBlockedCode, message: string) {
    super(message);
    this.name = "AgentStartBlockedError";
    this.status = status;
    this.code = code;
  }
}

export function countRunningSessions(
  sessions: Iterable<{ status: string }>,
): number {
  let n = 0;
  for (const session of sessions) {
    if (session.status === "running") {
      n += 1;
    }
  }
  return n;
}

export function listRunningSessions<T extends { status: string }>(sessions: Iterable<T>): T[] {
  return [...sessions]
    .filter((session) => session.status === "running")
    .sort((a, b) => {
      const aStarted = "startedAt" in a ? String((a as { startedAt?: string }).startedAt || "") : "";
      const bStarted = "startedAt" in b ? String((b as { startedAt?: string }).startedAt || "") : "";
      return aStarted < bStarted ? 1 : aStarted > bStarted ? -1 : 0;
    });
}

/** Refuse a second start on the same id, and cap parallel cursor-agent (or external) runs. */
export function assertAgentStartAllowed(
  sessions: Map<string, { id: string; status: string }>,
  sessionId: string,
  maxConcurrent = MAX_CONCURRENT_AGENT_RUNS,
): void {
  const existing = sessions.get(sessionId);
  if (existing?.status === "running") {
    throw new AgentStartBlockedError(
      409,
      "session_running",
      `Session ${sessionId} is already running. Stop it before sending another prompt on the same thread.`,
    );
  }
  const running = countRunningSessions(sessions.values());
  if (running >= maxConcurrent) {
    throw new AgentStartBlockedError(
      429,
      "concurrent_cap",
      `At most ${maxConcurrent} agent runs can be in progress at once. Stop one before starting another.`,
    );
  }
}

export function capSessionText(text: string, max = MAX_SESSION_OUTPUT_CHARS): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(-max);
}

export function capSessionBuffers(session: AgentSession): void {
  session.output = capSessionText(session.output);
  session.errorOutput = capSessionText(session.errorOutput);
}

export type SessionClientDto = {
  id: string;
  status: AgentSession["status"];
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  error?: string;
  cursorSessionId?: string;
  events: AgentSession["events"];
  liveSubagents?: AgentSession["liveSubagents"];
  outputChars: number;
  errorOutputChars: number;
  outputTail: string;
  errorOutputTail: string;
};

export function toSessionClientDto(
  session: AgentSession,
  eventLimit = SESSION_CLIENT_EVENT_LIMIT,
): SessionClientDto {
  const events = session.events ?? [];
  return {
    id: session.id,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    exitCode: session.exitCode,
    error: session.error,
    cursorSessionId: session.cursorSessionId,
    events: events.slice(-Math.max(1, eventLimit)),
    liveSubagents: session.liveSubagents,
    outputChars: (session.output || "").length,
    errorOutputChars: (session.errorOutput || "").length,
    outputTail: (session.output || "").slice(-4000),
    errorOutputTail: (session.errorOutput || "").slice(-4000),
  };
}

export function evictIdleSessions(sessions: Map<string, AgentSession>, keep = MAX_LIVE_SESSIONS): string[] {
  if (sessions.size <= keep) {
    return [];
  }
  const idle = [...sessions.values()]
    .filter((s) => s.status !== "running")
    .sort((a, b) => (a.endedAt || a.startedAt).localeCompare(b.endedAt || b.startedAt));
  const dropCount = sessions.size - keep;
  const dropped: string[] = [];
  for (const row of idle) {
    if (dropped.length >= dropCount) {
      break;
    }
    sessions.delete(row.id);
    dropped.push(row.id);
  }
  return dropped;
}

export function enqueueExclusiveWrite(
  chains: Map<string, Promise<void>>,
  key: string,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = chains.get(key) ?? Promise.resolve();
  const job = prev.then(fn, fn);
  chains.set(
    key,
    job.catch(() => {
      /* keep queue alive */
    }),
  );
  return job;
}

/** Pin headless cursor-agent to a workspace so a later UI cwd change does not retarget the child. */
export function ensureHeadlessWorkspaceArgs(args: string[], workspaceDir: string): string[] {
  const next = [...args];
  if (workspaceDir && !next.includes("--workspace")) {
    next.push("--workspace", workspaceDir);
  }
  if (!next.includes("--trust")) {
    next.push("--trust");
  }
  return next;
}
