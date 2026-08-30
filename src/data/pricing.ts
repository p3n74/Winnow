import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Built-in USD per million tokens — placeholders; override via ~/.winnow/pricing.json */
const BUILTIN_USD_PER_MILLION: Record<string, PricingEntry> = {
  default: { inPerMillion: 0, outPerMillion: 0 },
  auto: { inPerMillion: 0, outPerMillion: 0 },
  composer: { inPerMillion: 0, outPerMillion: 0 },
  "gpt-4o": { inPerMillion: 2.5, outPerMillion: 10 },
  "gpt-4o-mini": { inPerMillion: 0.15, outPerMillion: 0.6 },
  "claude-3-5-sonnet": { inPerMillion: 3, outPerMillion: 15 },
  "claude-3-5-haiku": { inPerMillion: 0.8, outPerMillion: 4 },
};

export type PricingEntry = { inPerMillion: number; outPerMillion: number };

export function pricingOverridePath(): string {
  const fromEnv = process.env.WINNOW_PRICING_FILE?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return join(homedir(), ".winnow", "pricing.json");
}

function finiteNonNeg(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

export function parsePricingEntry(value: unknown): PricingEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const inM = finiteNonNeg(row.inPerMillion);
  const outM = finiteNonNeg(row.outPerMillion);
  if (inM !== null && outM !== null) {
    return { inPerMillion: inM, outPerMillion: outM };
  }
  const in1k = finiteNonNeg(row.inPer1k);
  const out1k = finiteNonNeg(row.outPer1k);
  if (in1k !== null && out1k !== null) {
    return { inPerMillion: in1k * 1000, outPerMillion: out1k * 1000 };
  }
  return null;
}

function readOverrides(): Record<string, PricingEntry> {
  try {
    const raw = readFileSync(pricingOverridePath(), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, PricingEntry> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const entry = parsePricingEntry(value);
      if (entry) {
        out[key.toLowerCase()] = entry;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function writePricingOverrides(entries: Record<string, PricingEntry>): void {
  const path = pricingOverridePath();
  mkdirSync(dirname(path), { recursive: true });
  const serialized: Record<string, PricingEntry> = {};
  for (const [key, value] of Object.entries(entries)) {
    serialized[key.toLowerCase()] = {
      inPerMillion: value.inPerMillion,
      outPerMillion: value.outPerMillion,
    };
  }
  writeFileSync(path, `${JSON.stringify(serialized, null, 2)}\n`, "utf8");
}

export function getDefaultUsdPerMillion(): PricingEntry {
  const overrides = readOverrides();
  return overrides.default ?? BUILTIN_USD_PER_MILLION.default;
}

export function setDefaultUsdPerMillion(inPerMillion: number, outPerMillion: number): PricingEntry {
  const inVal = finiteNonNeg(inPerMillion);
  const outVal = finiteNonNeg(outPerMillion);
  if (inVal === null || outVal === null) {
    throw new Error("Input and output prices must be finite numbers ≥ 0.");
  }
  const next = { ...readOverrides(), default: { inPerMillion: inVal, outPerMillion: outVal } };
  writePricingOverrides(next);
  return next.default;
}

export function getPricingForModel(model: string | null | undefined): PricingEntry {
  const overrides = readOverrides();
  const key = (model || "default").toLowerCase().trim() || "default";
  if (overrides[key]) {
    return overrides[key];
  }
  const fallback = overrides.default ?? BUILTIN_USD_PER_MILLION.default;
  if (key === "auto" || key === "composer") {
    return fallback;
  }
  if (BUILTIN_USD_PER_MILLION[key]) {
    return BUILTIN_USD_PER_MILLION[key];
  }
  return fallback;
}

export function estimateCostUsd(
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = getPricingForModel(model);
  return (inputTokens / 1_000_000) * p.inPerMillion + (outputTokens / 1_000_000) * p.outPerMillion;
}
