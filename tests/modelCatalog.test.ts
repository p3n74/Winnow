import { describe, expect, it } from "vitest";
import {
  correctCursorModelLabel,
  cursorModelLabelsMatch,
  enrichCursorModelsForContext,
  isEmptyCursorModelsListing,
  parseCursorModelsOutput,
  parseFlatCursorVariant,
} from "../src/cursor/modelCatalog.js";

describe("parseCursorModelsOutput", () => {
  it("parses id-label rows and pins Auto first", () => {
    const options = parseCursorModelsOutput(`Available models

gpt-5.5 - GPT-5.5
auto - Auto (current, default)
composer-2.5 - Composer 2.5
Tip: use --model <id>
`);
    expect(options.map((item) => item.id)).toEqual(["auto", "gpt-5.5", "composer-2.5"]);
    expect(options[0]?.label).toBe("Auto");
  });

  it("treats an empty account listing as no models", () => {
    expect(isEmptyCursorModelsListing("No models available for this account.\n")).toBe(true);
    expect(parseCursorModelsOutput("No models available for this account.")).toEqual([]);
  });

  it("corrects false 1M labels on flat slugs and adds parameterized 1M options", () => {
    const options = parseCursorModelsOutput(`Available models

auto - Auto (current, default)
claude-sonnet-5-high - Claude Sonnet 5 1M
claude-sonnet-5-thinking-high - Claude Sonnet 5 1M Thinking
claude-opus-5-5-medium - Claude Opus 5.5 1M
claude-opus-5-5-medium-fast - Claude Opus 5.5 1M Fast
gpt-5.6-sol-high - GPT-5.6 Sol 1M High
gpt-5.6-luna-high - GPT-5.6 Luna 1M High
composer-2.5 - Composer 2.5
Tip: use --model <id>
`);
    const byId = new Map(options.map((item) => [item.id, item.label]));

    expect(byId.get("claude-sonnet-5-high")).toBe("Claude Sonnet 5 300K");
    expect(byId.get("claude-sonnet-5-thinking-high")).toBe("Claude Sonnet 5 300K Thinking");
    expect(byId.get("claude-opus-5-5-medium")).toBe("Claude Opus 5.5 300K");
    expect(byId.get("gpt-5.6-sol-high")).toBe("GPT-5.6 Sol 272K High");
    expect(byId.get("gpt-5.6-luna-high")).toBe("GPT-5.6 Luna 272K High");

    expect(byId.get("claude-sonnet-5[thinking=false,context=1m,effort=high]")).toBe(
      "Claude Sonnet 5 1M",
    );
    expect(byId.get("claude-sonnet-5[thinking=true,context=1m,effort=high]")).toBe(
      "Claude Sonnet 5 1M Thinking",
    );
    expect(byId.get("claude-opus-5-5[context=1m,effort=medium,fast=false]")).toBe(
      "Claude Opus 5.5 1M",
    );
    expect(byId.get("claude-opus-5-5[context=1m,effort=medium,fast=true]")).toBe(
      "Claude Opus 5.5 1M Fast",
    );
    expect(byId.get("gpt-5.6-sol[context=1m,reasoning=high,fast=false]")).toBe(
      "GPT-5.6 Sol 1M High",
    );
    // Luna has no max-context override in CLI yet — label fixed, no 1M sibling.
    expect(byId.has("gpt-5.6-luna[context=1m,reasoning=high,fast=false]")).toBe(false);
    expect(byId.get("composer-2.5")).toBe("Composer 2.5");
    expect(options[0]?.id).toBe("auto");
  });

  it("maps flat extra-high to parameterized xhigh for GPT models", () => {
    const options = parseCursorModelsOutput(`Available models

gpt-5.6-sol-xhigh - GPT-5.6 Sol 1M Extra High
gpt-5.5-extra-high - GPT-5.5 1M Extra High
`);
    const byId = new Map(options.map((item) => [item.id, item.label]));
    expect(byId.get("gpt-5.6-sol-xhigh")).toBe("GPT-5.6 Sol 272K Extra High");
    expect(byId.get("gpt-5.6-sol[context=1m,reasoning=xhigh,fast=false]")).toBe(
      "GPT-5.6 Sol 1M Extra High",
    );
    expect(byId.get("gpt-5.5-extra-high")).toBe("GPT-5.5 272K Extra High");
    // GPT-5.5 extra-high has no working parameterized 1M form yet.
    expect(byId.has("gpt-5.5[context=1m,reasoning=xhigh,fast=false]")).toBe(false);
    expect(byId.has("gpt-5.5[context=1m,reasoning=extra-high,fast=false]")).toBe(false);
  });

  it("parses parameterized ids if cursor-agent lists them", () => {
    const options = parseCursorModelsOutput(`Available models

claude-sonnet-5[thinking=true,context=1m,effort=high] - Claude Sonnet 5 1M High
`);
    expect(options.map((item) => item.id)).toEqual([
      "claude-sonnet-5[thinking=true,context=1m,effort=high]",
    ]);
  });
});

describe("parseFlatCursorVariant", () => {
  it("parses thinking, effort, and fast suffixes", () => {
    expect(parseFlatCursorVariant("claude-sonnet-5-thinking-high")).toEqual({
      base: "claude-sonnet-5",
      thinking: true,
      effort: "high",
      fast: false,
    });
    expect(parseFlatCursorVariant("claude-opus-5-5-medium-fast")).toEqual({
      base: "claude-opus-5-5",
      thinking: false,
      effort: "medium",
      fast: true,
    });
    expect(parseFlatCursorVariant("claude-opus-4-8-thinking-xhigh-fast")).toEqual({
      base: "claude-opus-4-8",
      thinking: true,
      effort: "xhigh",
      fast: true,
    });
  });

  it("does not treat claude-sonnet-5-5 as claude-sonnet-5", () => {
    expect(parseFlatCursorVariant("claude-sonnet-5-5-high")).toBeNull();
  });
});

describe("correctCursorModelLabel / enrichCursorModelsForContext", () => {
  it("leaves unrelated labels alone", () => {
    expect(correctCursorModelLabel("composer-2.5", "Composer 2.5")).toBe("Composer 2.5");
  });

  it("is idempotent when enriching twice", () => {
    const once = enrichCursorModelsForContext([
      { id: "claude-sonnet-5-high", label: "Claude Sonnet 5 1M" },
    ]);
    const twice = enrichCursorModelsForContext(once);
    expect(twice).toEqual(once);
  });
});

describe("cursorModelLabelsMatch", () => {
  it("matches exact labels", () => {
    expect(cursorModelLabelsMatch("Claude Sonnet 5 300K High", "Claude Sonnet 5 300K High")).toBe(
      true,
    );
  });

  it("matches parameterized selections by context window", () => {
    expect(
      cursorModelLabelsMatch(
        "Claude Sonnet 5 1M Thinking",
        "Claude Sonnet 5 1M High",
        "claude-sonnet-5[thinking=true,context=1m,effort=high]",
      ),
    ).toBe(true);
    expect(
      cursorModelLabelsMatch(
        "Claude Sonnet 5 1M Thinking",
        "Claude Sonnet 5 300K High",
        "claude-sonnet-5[thinking=true,context=1m,effort=high]",
      ),
    ).toBe(false);
  });

  it("matches flat slugs whose init label adds a context token", () => {
    // Catalog label omits the window; cursor-agent reports it. No bracket id,
    // so the context must be ignored. (Grok 4.7 Medium regression.)
    expect(
      cursorModelLabelsMatch("Grok 4.7  Medium", "Grok 4.7 256K Medium", "grok-4.7-medium"),
    ).toBe(true);
    expect(
      cursorModelLabelsMatch("Claude Sonnet 5 300K", "Claude Sonnet 5 300K", "claude-sonnet-5-high"),
    ).toBe(true);
    // A flat slug that genuinely resolves to a different model still fails.
    expect(
      cursorModelLabelsMatch("Grok 4.7  Medium", "Grok 4.7 256K High", "grok-4.7-medium"),
    ).toBe(false);
  });
});
