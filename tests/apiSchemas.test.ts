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
