import type { AgentSession } from "./types.js";

export const MAX_SESSION_OUTPUT_CHARS = 512_000;
export const SESSION_CLIENT_EVENT_LIMIT = 500;
export const MAX_LIVE_SESSIONS = 32;
export const MAX_STDOUT_LINE_BUFFER = 1_000_000;

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
