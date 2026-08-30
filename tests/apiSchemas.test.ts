import { describe, expect, it } from "vitest";
import { agentStartRequestSchema, graphCorrectionsBodySchema } from "../src/cli/ui/apiSchemas.js";

describe("agentStartRequestSchema", () => {
  it("requires a non-empty prompt", () => {
    expect(agentStartRequestSchema.safeParse({ prompt: "  " }).success).toBe(false);
    expect(agentStartRequestSchema.safeParse({ prompt: "hi", graphSeed: true }).success).toBe(true);
  });

  it("rejects unknown executionMode", () => {
    expect(agentStartRequestSchema.safeParse({ prompt: "hi", executionMode: "cloud" }).success).toBe(false);
  });

  it("accepts cursorMode ask and rejects debug", () => {
    expect(agentStartRequestSchema.safeParse({ prompt: "hi", cursorMode: "ask" }).success).toBe(true);
    expect(agentStartRequestSchema.safeParse({ prompt: "hi", cursorMode: "plan" }).success).toBe(true);
    expect(agentStartRequestSchema.safeParse({ prompt: "hi", cursorMode: "debug" }).success).toBe(false);
  });

  it("allows an empty prompt only when a slash invocation or custom mode carries the request", () => {
    expect(
      agentStartRequestSchema.safeParse({
        prompt: "",
        slashInvocations: [{ kind: "command", id: "command:deploy-staging" }],
      }).success,
    ).toBe(true);
    expect(agentStartRequestSchema.safeParse({ prompt: "  ", customModeSkill: "tdd" }).success).toBe(true);
    expect(agentStartRequestSchema.safeParse({ prompt: "", slashInvocations: [] }).success).toBe(false);
    expect(agentStartRequestSchema.safeParse({ prompt: "  ", customModeSkill: "  " }).success).toBe(false);
  });

  it("rejects malformed slash invocations", () => {
    expect(
      agentStartRequestSchema.safeParse({ prompt: "hi", slashInvocations: [{ kind: "mode", id: "mode:ask" }] })
        .success,
    ).toBe(false);
    expect(
      agentStartRequestSchema.safeParse({ prompt: "hi", slashInvocations: [{ kind: "skill", id: "" }] }).success,
    ).toBe(false);
  });
});

describe("graphCorrectionsBodySchema", () => {
  it("rejects empty operations and unknown types", () => {
    expect(graphCorrectionsBodySchema.safeParse({ operations: [] }).success).toBe(false);
    expect(graphCorrectionsBodySchema.safeParse({ operations: [{ type: "nope" }] }).success).toBe(false);
    expect(
      graphCorrectionsBodySchema.safeParse({
        operations: [{ type: "update_node_summary", nodeId: "n1", summaryEn: "ok" }],
      }).success,
    ).toBe(true);
  });
});
