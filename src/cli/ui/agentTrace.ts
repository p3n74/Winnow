/**
 * Pick the agent session pane 1 Trace should follow: a running session if any,
 * otherwise the most recently ended (or started) session.
 */
export function pickActiveAgentSession<
  T extends { id: string; status: string; startedAt: string; endedAt?: string },
>(sessions: Iterable<T>): T | null {
  const list = [...sessions];
  if (list.length === 0) {
    return null;
  }

  const running = list.filter((session) => session.status === "running");
  if (running.length > 0) {
    running.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
    return running[0] ?? null;
  }

  list.sort((a, b) => {
    const aKey = a.endedAt || a.startedAt;
    const bKey = b.endedAt || b.startedAt;
    return aKey < bKey ? 1 : aKey > bKey ? -1 : 0;
  });
  return list[0] ?? null;
}
