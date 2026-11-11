import { mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  countCursorSubagentFiles,
  parseSubagentTranscript,
  readCursorSubagentTraces,
} from "../src/cursor/subagentTrace.js";

describe("parseSubagentTranscript", () => {
  it("records narration and tool calls, and stays running while the last turn still calls a tool", () => {
    const jsonl = [
      JSON.stringify({
        role: "user",
        message: { content: [{ type: "text", text: "You are implementing the backend gallery." }] },
      }),
      JSON.stringify({
        role: "assistant",
        message: {
          content: [
            { type: "text", text: "I'll read the matcher before changing it." },
            { type: "tool_use", name: "Read", input: { path: "/repo/src/register_id/matcher.py" } },
            { type: "tool_use", name: "Grep", input: { pattern: "faceEmbedding", path: "/repo" } },
          ],
        },
      }),
    ].join("\n");

    const parsed = parseSubagentTranscript(jsonl);
    expect(parsed.status).toBe("running");
    expect(parsed.steps.map((step) => step.label)).toEqual([
      "I'll read the matcher before changing it.",
      "Read matcher.py",
      "Grep faceEmbedding",
    ]);
  });

  it("marks the transcript done when the last assistant turn is text only", () => {
    const jsonl = [
      JSON.stringify({
        role: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Shell", input: { command: "uv run pytest -q" } }],
        },
      }),
      JSON.stringify({
        role: "assistant",
        message: { content: [{ type: "text", text: "Tests passed." }] },
      }),
      "{not json",
    ].join("\n");

    const parsed = parseSubagentTranscript(jsonl);
    expect(parsed.status).toBe("done");
    expect(parsed.steps.at(-1)).toEqual({ kind: "say", label: "Tests passed." });
    expect(parsed.steps[0]).toEqual({ kind: "tool", label: "Shell uv run pytest -q" });
  });
});

describe("readCursorSubagentTraces", () => {
  it("names transcripts from the parent Task titles in launch order", async () => {
    const root = await mkdtemp(join(tmpdir(), "winnow-subagent-trace-"));
    const chatId = "11111111-1111-1111-1111-111111111111";
    const dir = join(root, chatId, "subagents");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl"),
      JSON.stringify({
        role: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: { path: "models.py" } }] },
      }),
      "utf8",
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(
      join(dir, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jsonl"),
      JSON.stringify({
        role: "user",
        message: { content: [{ type: "text", text: "You are implementing the frontend oval." }] },
      }) +
        "\n" +
        JSON.stringify({
          role: "assistant",
          message: { content: [{ type: "text", text: "Oval guide is in place." }] },
        }),
      "utf8",
    );

    const traces = await readCursorSubagentTraces({
      workspaceRoot: "/tmp/unused",
      cursorSessionId: chatId,
      titles: ["Multi-view face gallery", "Oval guide and head sweep"],
      transcriptsRoot: root,
    });

    expect(traces.map((trace) => trace.name)).toEqual([
      "Multi-view face gallery",
      "Oval guide and head sweep",
    ]);
    expect(traces[0]?.status).toBe("running");
    expect(traces[0]?.steps?.[0]?.label).toBe("Read models.py");
    expect(traces[1]?.status).toBe("done");
    expect(traces[1]?.summary).toBe("Oval guide is in place.");
    expect(await countCursorSubagentFiles("/tmp/unused", chatId)).toBe(0);
    expect(await countCursorSubagentFiles("/tmp/unused", chatId, root)).toBe(2);
  });
});
