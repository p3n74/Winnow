import { describe, expect, it } from "vitest";
import {
  MAX_SESSION_OUTPUT_CHARS,
  capSessionBuffers,
  enqueueExclusiveWrite,
  evictIdleSessions,
  toSessionClientDto,
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
