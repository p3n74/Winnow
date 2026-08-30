import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  estimateCostUsd,
  getDefaultUsdPerMillion,
  getPricingForModel,
  parsePricingEntry,
  setDefaultUsdPerMillion,
} from "../src/data/pricing.js";

describe("pricing", () => {
  const previous = process.env.WINNOW_PRICING_FILE;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "winnow-pricing-"));
    process.env.WINNOW_PRICING_FILE = join(dir, "pricing.json");
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.WINNOW_PRICING_FILE;
    } else {
      process.env.WINNOW_PRICING_FILE = previous;
    }
  });

  it("parses per-million and legacy per-1k entries", () => {
    expect(parsePricingEntry({ inPerMillion: 2.5, outPerMillion: 10 })).toEqual({
      inPerMillion: 2.5,
      outPerMillion: 10,
    });
    expect(parsePricingEntry({ inPer1k: 0.0025, outPer1k: 0.01 })).toEqual({
      inPerMillion: 2.5,
      outPerMillion: 10,
    });
    expect(parsePricingEntry({ inPerMillion: -1, outPerMillion: 1 })).toBeNull();
  });

  it("uses Settings default rates for auto/composer and unknown models", () => {
    setDefaultUsdPerMillion(3, 15);
    expect(getDefaultUsdPerMillion()).toEqual({ inPerMillion: 3, outPerMillion: 15 });
    expect(getPricingForModel("auto")).toEqual({ inPerMillion: 3, outPerMillion: 15 });
    expect(getPricingForModel("composer")).toEqual({ inPerMillion: 3, outPerMillion: 15 });
    expect(getPricingForModel("some-new-model")).toEqual({ inPerMillion: 3, outPerMillion: 15 });
    expect(estimateCostUsd("auto", 1_000_000, 500_000)).toBeCloseTo(3 + 7.5);
  });

  it("keeps built-in per-model rates when no override exists", () => {
    expect(getPricingForModel("gpt-4o")).toEqual({ inPerMillion: 2.5, outPerMillion: 10 });
    expect(estimateCostUsd("gpt-4o", 1_000_000, 1_000_000)).toBeCloseTo(12.5);
  });

  it("preserves other model keys when saving defaults", () => {
    const path = process.env.WINNOW_PRICING_FILE!;
    writeFileSync(
      path,
      JSON.stringify({ "gpt-4o": { inPerMillion: 5, outPerMillion: 20 } }, null, 2),
      "utf8",
    );
    setDefaultUsdPerMillion(1, 2);
    const saved = JSON.parse(readFileSync(path, "utf8")) as Record<string, { inPerMillion: number }>;
    expect(saved.default).toEqual({ inPerMillion: 1, outPerMillion: 2 });
    expect(saved["gpt-4o"]).toEqual({ inPerMillion: 5, outPerMillion: 20 });
    expect(getPricingForModel("gpt-4o")).toEqual({ inPerMillion: 5, outPerMillion: 20 });
  });
});
