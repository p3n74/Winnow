import { z } from "zod";
import type { GraphEdge } from "../../graph/types.js";

export const agentStartRequestSchema = z
  .object({
    // May be empty when a slash invocation or a pinned Custom Mode carries the request.
    prompt: z.string(),
    args: z.string().optional(),
    modelPreference: z.string().optional(),
    autonomyMode: z.boolean().optional(),
    graphSeed: z.boolean().optional(),
    planId: z.string().optional(),
    sessionId: z.string().optional(),
    cursorSessionId: z.string().optional(),
    executionMode: z.enum(["cursor", "external"]).optional(),
    attachmentIds: z.array(z.string()).optional(),
    cursorMode: z.enum(["agent", "ask", "plan"]).optional(),
    slashInvocations: z
      .array(
        z.object({
          kind: z.enum(["command", "skill", "winnow", "builtin-skill"]),
          id: z.string().min(1),
        }),
      )
      .optional(),
    customModeSkill: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.prompt.trim().length > 0) {
      return;
    }
    if ((value.slashInvocations?.length ?? 0) > 0) {
      return;
    }
    if ((value.customModeSkill ?? "").trim().length > 0) {
      return;
    }
    ctx.addIssue({ code: "custom", path: ["prompt"], message: "prompt is required" });
  });

const graphEdgeKindSchema = z.enum([
  "contains",
  "depends_on",
  "calls",
  "reads",
  "writes",
  "emits",
  "consumes",
  "defines",
  "implements",
  "drives",
  "uses_external",
  "related_to",
] satisfies [GraphEdge["kind"], ...GraphEdge["kind"][]]);

export const graphCorrectionOpSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("lock_edge"), edgeId: z.string().min(1) }),
  z.object({ type: z.literal("remove_edge"), edgeId: z.string().min(1) }),
  z.object({
    type: z.literal("upsert_edge"),
    edge: z.object({
      fromId: z.string().min(1),
      toId: z.string().min(1),
      kind: graphEdgeKindSchema,
      summaryEn: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("update_node_summary"),
    nodeId: z.string().min(1),
    summaryEn: z.string(),
  }),
]);

export const graphCorrectionsBodySchema = z.object({
  operations: z.array(graphCorrectionOpSchema).min(1),
});

export const planCreateBodySchema = z.object({
  title: z.string().optional(),
  markdown: z.string().optional(),
  status: z.enum(["draft", "active", "blocked", "done"]).optional(),
});
