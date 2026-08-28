import { describe, expect, it } from "vitest";
import {
  buildResolverPrompt,
  extractWrittenPathFromToolEvent,
  findPathOverlaps,
  normalizeTouchedPath,
} from "../src/cli/ui/agentOverlap.js";

describe("extractWrittenPathFromToolEvent", () => {
  it("reads path from write/edit tool args", () => {
    expect(
      extractWrittenPathFromToolEvent({
        type: "tool_call",
        subtype: "started",
        tool_call: { writeToolCall: { args: { path: "./src/cli/ui.ts" } } },
      }),
    ).toBe("src/cli/ui.ts");
    expect(
      extractWrittenPathFromToolEvent({
        type: "tool_call",
        tool_call: { StrReplace: { args: { file_path: "README.md" } } },
      }),
    ).toBe("README.md");
  });

  it("ignores read/search tools", () => {
    expect(
      extractWrittenPathFromToolEvent({
        type: "tool_call",
        tool_call: { grepToolCall: { args: { path: "src", pattern: "foo" } } },
      }),
    ).toBeNull();
  });
});

describe("findPathOverlaps", () => {
  it("returns paths owned by more than one session", () => {
    const bySession = new Map<string, string[]>([
      ["a", ["src/foo.ts", "src/bar.ts"]],
      ["b", ["./src/foo.ts", "src/other.ts"]],
    ]);
    expect(findPathOverlaps(bySession)).toEqual([{ path: "src/foo.ts", sessionIds: ["a", "b"] }]);
  });

  it("returns empty when there is no collision", () => {
    const bySession = new Map<string, string[]>([
      ["a", ["src/foo.ts"]],
      ["b", ["src/bar.ts"]],
    ]);
    expect(findPathOverlaps(bySession)).toEqual([]);
  });
});

describe("buildResolverPrompt", () => {
  it("includes overlapping paths and git excerpts", () => {
    const prompt = buildResolverPrompt({
      overlaps: [{ path: "src/foo.ts", sessionIds: ["s1", "s2"] }],
      sessions: [
        { id: "s1", preview: "fix the parser", writtenPaths: ["src/foo.ts"] },
        { id: "s2", preview: "add tests", writtenPaths: ["src/foo.ts", "tests/foo.test.ts"] },
      ],
      gitStatus: " M src/foo.ts",
      gitDiffExcerpt: "diff --git a/src/foo.ts",
    });
    expect(prompt).toContain("conflict-resolver");
    expect(prompt).toContain("src/foo.ts (sessions: s1, s2)");
    expect(prompt).toContain("s1 — fix the parser");
    expect(prompt).toContain("diff --git a/src/foo.ts");
  });
});

describe("normalizeTouchedPath", () => {
  it("normalizes slashes and leading ./", () => {
    expect(normalizeTouchedPath("  .\\src\\a.ts  ")).toBe("src/a.ts");
  });
});
