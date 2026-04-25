import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** USD per 1k tokens — placeholders; override via ~/.winnow/pricing.json */
const BUILTIN_USD_PER_1K: Record<string, { inPer1k: number; outPer1k: number }> = {
  default: { inPer1k: 0, outPer1k: 0 },
  auto: { inPer1k: 0, outPer1k: 0 },
  composer: { inPer1k: 0, outPer1k: 0 },
  "gpt-4o": { inPer1k: 0.0025, outPer1k: 0.01 },
  "gpt-4o-mini": { inPer1k: 0.00015, outPer1k: 0.0006 },
  "claude-3-5-sonnet": { inPer1k: 0.003, outPer1k: 0.015 },
  "claude-3-5-haiku": { inPer1k: 0.0008, outPer1k: 0.004 },
};

export type PricingEntry = { inPer1k: number; outPer1k: number };

function pricingOverridePath(): string {
  return join(homedir(), ".winnow", "pricing.json");
}

function readOverrides(): Record<string, PricingEntry> {
  try {
    const raw = readFileSync(pricingOverridePath(), "utf8");
    const parsed = JSON.parse(raw) as Record<string, { inPer1k?: number; outPer1k?: number }>;
    const out: Record<string, PricingEntry> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value?.inPer1k === "number" && typeof value?.outPer1k === "number") {
        out[key.toLowerCase()] = { inPer1k: value.inPer1k, outPer1k: value.outPer1k };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function getPricingForModel(model: string | null | undefined): PricingEntry {
  const overrides = readOverrides();
  const key = (model || "default").toLowerCase().trim();
  if (overrides[key]) {
    return overrides[key];
  }
  if (BUILTIN_USD_PER_1K[key]) {
    return BUILTIN_USD_PER_1K[key];
  }
  return BUILTIN_USD_PER_1K.default;
}

export function estimateCostUsd(
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = getPricingForModel(model);
  return (inputTokens / 1000) * p.inPer1k + (outputTokens / 1000) * p.outPer1k;
}
