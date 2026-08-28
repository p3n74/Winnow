import { describe, expect, it } from "vitest";
import {
  MAX_SESSION_OUTPUT_CHARS,
  assertAgentStartAllowed,
  capSessionBuffers,
  countRunningSessions,
  enqueueExclusiveWrite,
  ensureHeadlessWorkspaceArgs,
  evictIdleSessions,
  listRunningSessions,
  toSessionClientDto,
  AgentStartBlockedError,
} from "../src/cli/ui/sessionDto.js";
import type { AgentSession } from "../src/cli/ui/types.js";

function sess(partial: Partial<AgentSession> & Pick<AgentSession, "id">): AgentSession {
  return {
    status: "done",
    startedAt: "2026-01-01T00:00:00.000Z",
    output: "",
    errorOutput: "",
    command: "cursor-agent",
    args: [],
    events: [],
    ...partial,
  };
}

describe("toSessionClientDto", () => {
  it("slices events and does not copy full output", () => {
    const events = Array.from({ length: 600 }, (_, i) => ({
      id: `e${i}`,
      ts: "t",
      kind: "assistant" as const,
      content: "x",
    }));
    const session = sess({
      id: "s1",
      output: "x".repeat(8000),
      events,
    });
    const dto = toSessionClientDto(session, 500);
    expect(dto.events).toHaveLength(500);
    expect(dto.events[0]?.id).toBe("e100");
    expect(dto.outputChars).toBe(8000);
    expect(dto.outputTail.length).toBe(4000);
    expect(dto).not.toHaveProperty("output");
  });
});

describe("capSessionBuffers", () => {
  it("keeps a tail when output exceeds the cap", () => {
    const session = sess({ id: "s2", output: "a".repeat(MAX_SESSION_OUTPUT_CHARS + 50) });
    capSessionBuffers(session);
    expect(session.output.length).toBe(MAX_SESSION_OUTPUT_CHARS);
    expect(session.output.endsWith("a".repeat(10))).toBe(true);
  });
});

describe("evictIdleSessions", () => {
  it("drops oldest non-running sessions when over keep", () => {
    const map = new Map<string, AgentSession>();
    map.set("run", sess({ id: "run", status: "running" }));
    map.set("old", sess({ id: "old", endedAt: "2020-01-01T00:00:00.000Z" }));
    map.set("new", sess({ id: "new", endedAt: "2026-01-01T00:00:00.000Z" }));
    const dropped = evictIdleSessions(map, 2);
    expect(dropped).toEqual(["old"]);
    expect(map.has("run")).toBe(true);
    expect(map.has("new")).toBe(true);
  });
});

describe("enqueueExclusiveWrite", () => {
  it("runs jobs for one key in order without overlap", async () => {
    const chains = new Map<string, Promise<void>>();
    const log: string[] = [];
    let inflight = 0;
    const job = (label: string, ms: number) =>
      enqueueExclusiveWrite(chains, "s", async () => {
        inflight += 1;
        expect(inflight).toBe(1);
        await new Promise((r) => setTimeout(r, ms));
        log.push(label);
        inflight -= 1;
      });
    await Promise.all([job("a", 20), job("b", 5)]);
    expect(log).toEqual(["a", "b"]);
  });
});

describe("assertAgentStartAllowed", () => {
  it("rejects a second start on a running session id", () => {
    const map = new Map<string, AgentSession>();
    map.set("s1", sess({ id: "s1", status: "running" }));
    try {
      assertAgentStartAllowed(map, "s1");
      expect.fail("expected AgentStartBlockedError");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentStartBlockedError);
      expect((error as AgentStartBlockedError).status).toBe(409);
      expect((error as AgentStartBlockedError).code).toBe("session_running");
    }
  });

  it("rejects a new session when the concurrent cap is full", () => {
    const map = new Map<string, AgentSession>();
    map.set("a", sess({ id: "a", status: "running" }));
    map.set("b", sess({ id: "b", status: "running" }));
    map.set("c", sess({ id: "c", status: "running" }));
    try {
      assertAgentStartAllowed(map, "d", 3);
      expect.fail("expected AgentStartBlockedError");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentStartBlockedError);
      expect((error as AgentStartBlockedError).status).toBe(429);
      expect((error as AgentStartBlockedError).code).toBe("concurrent_cap");
    }
  });

  it("allows continuing a finished session while others are running under the cap", () => {
    const map = new Map<string, AgentSession>();
    map.set("a", sess({ id: "a", status: "running" }));
    map.set("idle", sess({ id: "idle", status: "done" }));
    expect(() => assertAgentStartAllowed(map, "idle", 3)).not.toThrow();
    expect(() => assertAgentStartAllowed(map, "fresh", 3)).not.toThrow();
  });
});

describe("listRunningSessions", () => {
  it("returns only running sessions newest first", () => {
    const rows = listRunningSessions([
      sess({ id: "done", status: "done", startedAt: "2026-01-03T00:00:00.000Z" }),
      sess({ id: "old", status: "running", startedAt: "2026-01-01T00:00:00.000Z" }),
      sess({ id: "new", status: "running", startedAt: "2026-01-02T00:00:00.000Z" }),
    ]);
    expect(rows.map((s) => s.id)).toEqual(["new", "old"]);
    expect(countRunningSessions(rows)).toBe(2);
  });
});

describe("ensureHeadlessWorkspaceArgs", () => {
  it("adds --workspace and --trust when missing", () => {
    expect(ensureHeadlessWorkspaceArgs(["--print"], "/tmp/proj")).toEqual([
      "--print",
      "--workspace",
      "/tmp/proj",
      "--trust",
    ]);
  });

  it("does not duplicate existing --workspace or --trust", () => {
    expect(
      ensureHeadlessWorkspaceArgs(["--workspace", "/keep", "--trust", "--print"], "/tmp/other"),
    ).toEqual(["--workspace", "/keep", "--trust", "--print"]);
  });
});
