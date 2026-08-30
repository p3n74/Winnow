import { describe, expect, it } from "vitest";
import {
  ASK_MODE_PROMPT_PREFIX,
  PLAN_MODE_PROMPT_PREFIX,
  ensureCursorModeArg,
  normalizeCursorMode,
  stripCursorModeArgs,
} from "../src/cursor/cursorMode.js";

describe("normalizeCursorMode", () => {
  it("accepts ask and plan case-insensitively", () => {
    expect(normalizeCursorMode("ask")).toBe("ask");
    expect(normalizeCursorMode("Plan")).toBe("plan");
    expect(normalizeCursorMode(" ASK ")).toBe("ask");
  });

  it("falls back to agent for anything else", () => {
    expect(normalizeCursorMode("agent")).toBe("agent");
    expect(normalizeCursorMode("debug")).toBe("agent");
    expect(normalizeCursorMode("")).toBe("agent");
    expect(normalizeCursorMode(undefined)).toBe("agent");
    expect(normalizeCursorMode(7)).toBe("agent");
  });
});

describe("stripCursorModeArgs", () => {
  it("removes --mode, --mode=x and --plan without touching unrelated args", () => {
    expect(stripCursorModeArgs(["--mode", "ask", "--print"])).toEqual(["--print"]);
    expect(stripCursorModeArgs(["--mode=plan", "--force"])).toEqual(["--force"]);
    expect(stripCursorModeArgs(["--plan", "--model", "auto"])).toEqual(["--model", "auto"]);
    expect(stripCursorModeArgs(["--planner", "x"])).toEqual(["--planner", "x"]);
  });

  it("tolerates a trailing --mode with no value", () => {
    expect(stripCursorModeArgs(["--print", "--mode"])).toEqual(["--print"]);
  });
});

describe("ensureCursorModeArg", () => {
  it("passes no --mode for agent", () => {
    expect(ensureCursorModeArg(["--print"], "agent")).toEqual(["--print"]);
    expect(ensureCursorModeArg(["--print"], "agent").join(" ")).not.toContain("--mode");
  });

  it("appends --mode ask and --mode plan", () => {
    expect(ensureCursorModeArg(["--print"], "ask")).toEqual(["--print", "--mode", "ask"]);
    expect(ensureCursorModeArg(["--print"], "plan")).toEqual(["--print", "--mode", "plan"]);
  });

  it("replaces user-supplied mode flags instead of duplicating them", () => {
    expect(ensureCursorModeArg(["--mode", "plan", "--print"], "ask")).toEqual(["--print", "--mode", "ask"]);
    expect(ensureCursorModeArg(["--plan", "--print"], "agent")).toEqual(["--print"]);
    expect(ensureCursorModeArg(["--mode=ask", "--print"], "plan")).toEqual(["--print", "--mode", "plan"]);
  });

  it("never emits --mode agent or --mode debug", () => {
    for (const mode of ["agent", "ask", "plan"] as const) {
      const joined = ensureCursorModeArg(["--mode", "debug", "--print"], mode).join(" ");
      expect(joined).not.toContain("--mode agent");
      expect(joined).not.toContain("debug");
    }
  });
});

describe("mode prompt prefixes", () => {
  it("tells Ask not to edit and Plan not to implement yet", () => {
    expect(ASK_MODE_PROMPT_PREFIX.toLowerCase()).toContain("do not create, edit");
    expect(ASK_MODE_PROMPT_PREFIX.toLowerCase()).toContain("shell");
    expect(PLAN_MODE_PROMPT_PREFIX.toLowerCase()).toContain("plan");
    expect(PLAN_MODE_PROMPT_PREFIX.toLowerCase()).toContain("do not create, edit");
  });
});
