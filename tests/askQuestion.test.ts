import { describe, expect, it } from "vitest";
import { parseStreamAskQuestion } from "../src/cursor/askQuestion.js";

describe("parseStreamAskQuestion", () => {
  it("reads the print-mode interaction_query request", () => {
    const parsed = parseStreamAskQuestion({
      type: "interaction_query",
      subtype: "request",
      query_type: "askQuestionInteractionQuery",
      query: {
        id: 0,
        askQuestionInteractionQuery: {
          args: {
            title: "Pick a color",
            questions: [
              {
                id: "color",
                prompt: "Pick a color",
                options: [
                  { id: "red", label: "Red" },
                  { id: "blue", label: "Blue" },
                ],
                allowMultiple: false,
              },
            ],
          },
          toolCallId: "tool_1",
        },
      },
    });
    expect(parsed).toEqual({
      key: "tool_1",
      title: "Pick a color",
      questions: [
        {
          id: "color",
          prompt: "Pick a color",
          allowMultiple: false,
          options: [
            { id: "red", label: "Red" },
            { id: "blue", label: "Blue" },
          ],
        },
      ],
    });
  });

  it("ignores the synthetic skipped response", () => {
    expect(
      parseStreamAskQuestion({
        type: "interaction_query",
        subtype: "response",
        query_type: "askQuestionInteractionQuery",
        response: {
          id: 0,
          askQuestionInteractionResponse: {
            result: { rejected: { reason: "Questions skipped by the user, continue with the information you already have" } },
          },
        },
      }),
    ).toBeNull();
  });

  it("reads a started askQuestion tool call", () => {
    const parsed = parseStreamAskQuestion({
      type: "tool_call",
      subtype: "started",
      call_id: "tool_1",
      tool_call: {
        askQuestionToolCall: {
          args: {
            title: "Pick a color",
            questions: [
              {
                id: "color",
                prompt: "Pick a color",
                options: [{ id: "red", label: "Red" }],
              },
            ],
          },
          toolCallId: "tool_1",
        },
      },
    });
    expect(parsed?.key).toBe("tool_1");
    expect(parsed?.questions[0]?.id).toBe("color");
  });
});
