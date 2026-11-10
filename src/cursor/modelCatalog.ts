export type CursorModelOption = {
  id: string;
  label: string;
};

const EFFORT_TOKEN = "none|low|medium|high|extra-high|xhigh|max|minimal";
const FLAT_VARIANT_RE = new RegExp(
  `^(?<base>.+?)(?:-(?<thinking>thinking))?(?:-(?<effort>${EFFORT_TOKEN}))?(?<fast>-fast)?$`,
  "i",
);

type FlatVariant = {
  base: string;
  thinking: boolean;
  effort: string | null;
  fast: boolean;
};

type FamilySchema = {
  /** Longest-prefix base id, e.g. claude-opus-5-5 before claude-opus-5. */
  base: string;
  /** Display token used in labels (e.g. 300K). */
  defaultContextLabel: string;
  /** Bracket context= value for the default window. */
  defaultContextParam: string;
  /** When set, synthesize a real 1M option via bracket syntax. */
  maxContextParam?: "1m";
  /**
   * Parameter layout for --model 'base[...]' forms.
   * Order matters; cursor-agent rejects partial or reordered params.
   */
  layout:
    | "thinking,context,effort"
    | "thinking,context,effort,fast"
    | "context,effort,fast"
    | "context,reasoning,fast";
};

/**
 * Families where --list-models still prints a misleading "1M" on flat legacy
 * slugs that actually open the default window. Bracket overrides select 1M.
 * Longer bases must appear before shorter prefixes (opus-5-5 before opus-5).
 */
const FAMILY_SCHEMAS: FamilySchema[] = [
  {
    base: "claude-opus-5-5",
    defaultContextLabel: "300K",
    defaultContextParam: "300k",
    maxContextParam: "1m",
    layout: "context,effort,fast",
  },
  {
    base: "claude-opus-4-8",
    defaultContextLabel: "300K",
    defaultContextParam: "300k",
    maxContextParam: "1m",
    layout: "thinking,context,effort,fast",
  },
  {
    base: "claude-opus-4-7",
    defaultContextLabel: "300K",
    defaultContextParam: "300k",
    maxContextParam: "1m",
    layout: "thinking,context,effort,fast",
  },
  {
    base: "claude-opus-5",
    defaultContextLabel: "300K",
    defaultContextParam: "300k",
    maxContextParam: "1m",
    layout: "thinking,context,effort,fast",
  },
  {
    base: "claude-sonnet-5",
    defaultContextLabel: "300K",
    defaultContextParam: "300k",
    maxContextParam: "1m",
    layout: "thinking,context,effort",
  },
  {
    base: "claude-fable-5",
    defaultContextLabel: "300K",
    defaultContextParam: "300k",
    maxContextParam: "1m",
    layout: "thinking,context,effort",
  },
  {
    base: "claude-4.6-sonnet",
    defaultContextLabel: "200K",
    defaultContextParam: "200k",
    layout: "thinking,context,effort",
  },
  {
    base: "claude-4.6-opus",
    defaultContextLabel: "200K",
    defaultContextParam: "200k",
    layout: "thinking,context,effort",
  },
  {
    base: "gpt-5.6-sol",
    defaultContextLabel: "272K",
    defaultContextParam: "272k",
    maxContextParam: "1m",
    layout: "context,reasoning,fast",
  },
  {
    base: "gpt-5.6-terra",
    defaultContextLabel: "272K",
    defaultContextParam: "272k",
    maxContextParam: "1m",
    layout: "context,reasoning,fast",
  },
  {
    base: "gpt-5.6-luna",
    defaultContextLabel: "272K",
    defaultContextParam: "272k",
    layout: "context,reasoning,fast",
  },
  {
    base: "gpt-5.5",
    defaultContextLabel: "272K",
    defaultContextParam: "272k",
    maxContextParam: "1m",
    layout: "context,reasoning,fast",
  },
  {
    base: "gpt-5.4",
    defaultContextLabel: "272K",
    defaultContextParam: "272k",
    maxContextParam: "1m",
    layout: "context,reasoning,fast",
  },
  {
    base: "muse-spark-1.3",
    defaultContextLabel: "300K",
    defaultContextParam: "300k",
    layout: "thinking,context,effort",
  },
];

function findFamilySchema(modelId: string): FamilySchema | null {
  const id = modelId.trim().toLowerCase();
  const basePart = id.includes("[") ? id.slice(0, id.indexOf("[")) : id;
  let best: FamilySchema | null = null;
  for (const schema of FAMILY_SCHEMAS) {
    if (basePart === schema.base || basePart.startsWith(`${schema.base}-`)) {
      if (!best || schema.base.length > best.base.length) {
        best = schema;
      }
    }
  }
  // Exclude sibling bases that share a prefix (claude-sonnet-5-5 vs claude-sonnet-5).
  if (best && basePart !== best.base && !basePart.startsWith(`${best.base}-`)) {
    return null;
  }
  if (best) {
    const rest = basePart.slice(best.base.length);
    if (rest && !rest.startsWith("-")) {
      return null;
    }
    // claude-sonnet-5-5 is a different family than claude-sonnet-5.
    if (best.base === "claude-sonnet-5" && basePart.startsWith("claude-sonnet-5-5")) {
      return null;
    }
    if (best.base === "claude-opus-5" && basePart.startsWith("claude-opus-5-5")) {
      return null;
    }
  }
  return best;
}

export function parseFlatCursorVariant(modelId: string): FlatVariant | null {
  const trimmed = modelId.trim();
  if (!trimmed || trimmed.includes("[")) {
    return null;
  }
  const schema = findFamilySchema(trimmed);
  if (!schema) {
    return null;
  }
  const rest = trimmed.slice(schema.base.length).replace(/^-/, "");
  if (!rest) {
    return { base: schema.base, thinking: false, effort: null, fast: false };
  }
  // Common shapes:
  //   thinking-<effort>[-fast]
  //   <effort>[-fast]
  //   <effort>-thinking   (older Claude 4.6 style)
  const matched = rest.match(
    new RegExp(
      `^(?:(?<thinkingPrefix>thinking)-)?(?<effort>${EFFORT_TOKEN})(?:-(?<thinkingSuffix>thinking))?(?<fast>-fast)?$`,
      "i",
    ),
  );
  if (!matched?.groups?.effort) {
    const full = trimmed.match(FLAT_VARIANT_RE);
    if (!full?.groups || full.groups.base?.toLowerCase() !== schema.base) {
      return null;
    }
    return {
      base: schema.base,
      thinking: Boolean(full.groups.thinking),
      effort: full.groups.effort ? full.groups.effort.toLowerCase() : null,
      fast: Boolean(full.groups.fast),
    };
  }
  return {
    base: schema.base,
    thinking: Boolean(matched.groups.thinkingPrefix || matched.groups.thinkingSuffix),
    effort: matched.groups.effort.toLowerCase(),
    fast: Boolean(matched.groups.fast),
  };
}

function formatParameterizedId(
  schema: FamilySchema,
  variant: FlatVariant,
  contextParam: string,
): string | null {
  const effortRaw = variant.effort;
  if (!effortRaw && (schema.layout.includes("effort") || schema.layout.includes("reasoning"))) {
    return null;
  }
  // Flat GPT-5.5 uses "extra-high"; its parameterized allowlist does not accept
  // extra-high/xhigh, so skip synthesizing a 1M sibling for that slug.
  let effort = effortRaw;
  if (effortRaw === "extra-high") {
    if (schema.base === "gpt-5.5") {
      return null;
    }
    effort = "xhigh";
  }
  const thinking = variant.thinking ? "true" : "false";
  const fast = variant.fast ? "true" : "false";
  switch (schema.layout) {
    case "thinking,context,effort":
      if (!effort) {
        return null;
      }
      return `${schema.base}[thinking=${thinking},context=${contextParam},effort=${effort}]`;
    case "thinking,context,effort,fast":
      if (!effort) {
        return null;
      }
      return `${schema.base}[thinking=${thinking},context=${contextParam},effort=${effort},fast=${fast}]`;
    case "context,effort,fast":
      if (!effort) {
        return null;
      }
      return `${schema.base}[context=${contextParam},effort=${effort},fast=${fast}]`;
    case "context,reasoning,fast":
      if (!effort) {
        return null;
      }
      return `${schema.base}[context=${contextParam},reasoning=${effort},fast=${fast}]`;
    default:
      return null;
  }
}

function swapContextInLabel(label: string, contextLabel: string): string {
  if (/\b1\s*M\b/i.test(label) || /\b\d+\s*K\b/i.test(label)) {
    return label
      .replace(/\b1\s*M\b/gi, contextLabel)
      .replace(/\b\d+\s*K\b/gi, contextLabel);
  }
  return `${label} ${contextLabel}`.replace(/\s+/g, " ").trim();
}

export function correctCursorModelLabel(id: string, label: string): string {
  const schema = findFamilySchema(id);
  if (!schema) {
    return label;
  }
  if (!/\b1\s*M\b/i.test(label)) {
    return label;
  }
  // Flat legacy slugs labeled "1M" actually open the default window.
  if (!id.includes("[")) {
    return label.replace(/\b1\s*M\b/gi, schema.defaultContextLabel);
  }
  const contextParam = id.match(/\[(?:[^\]]*?\b)?context=([^,\]]+)/i)?.[1]?.toLowerCase();
  if (!contextParam) {
    return label;
  }
  if (contextParam === "1m") {
    return label.replace(/\b\d+\s*K\b/gi, "1M").replace(/\b1\s*M\b/gi, "1M");
  }
  if (contextParam === schema.defaultContextParam) {
    return label.replace(/\b1\s*M\b/gi, schema.defaultContextLabel);
  }
  return label;
}

/**
 * Cursor's --list-models dump is a flat legacy allowlist. Many rows are labeled
 * "1M" but resolve to the default context window. Parameterized models need
 * quoted bracket overrides such as:
 *   claude-sonnet-5[thinking=true,context=1m,effort=high]
 * This expands the flat listing into accurate default + 1M options where known.
 */
export function enrichCursorModelsForContext(options: CursorModelOption[]): CursorModelOption[] {
  const enriched: CursorModelOption[] = [];
  const seen = new Set<string>();

  const push = (option: CursorModelOption) => {
    const key = option.id.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    enriched.push(option);
  };

  for (const option of options) {
    const schema = findFamilySchema(option.id);
    const correctedLabel = correctCursorModelLabel(option.id, option.label);
    push({ id: option.id, label: correctedLabel });

    if (!schema?.maxContextParam || option.id.includes("[")) {
      continue;
    }
    const variant = parseFlatCursorVariant(option.id);
    if (!variant) {
      continue;
    }
    const maxId = formatParameterizedId(schema, variant, schema.maxContextParam);
    if (!maxId) {
      continue;
    }
    push({
      id: maxId,
      label: swapContextInLabel(option.label, "1M"),
    });
  }

  return pinAutoFirst(enriched);
}

export function isEmptyCursorModelsListing(raw: string): boolean {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) {
    return true;
  }
  return (
    text.includes("no models available") ||
    text.includes("authentication required") ||
    text.includes("not logged in") ||
    text.includes("please run 'agent login'")
  );
}

export function parseCursorModelLine(rawLine: string): CursorModelOption | null {
  const trimmed = rawLine.trim();
  if (!trimmed) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  if (
    lower.includes("available model") ||
    lower.startsWith("tip:") ||
    isEmptyCursorModelsListing(trimmed)
  ) {
    return null;
  }
  // Flat: id - label
  // Parameterized: base[context=1m,effort=high] - Label
  const dashed = trimmed.match(/^([A-Za-z0-9._\-]+(?:\[[^\]]+\])?)\s+-\s+(.+?)\s*$/);
  if (dashed?.[1]) {
    let label = dashed[2] || dashed[1];
    label = label.replace(/\s*\((?:current|default)(?:,\s*(?:current|default))*\)\s*$/i, "").trim();
    return { id: dashed[1], label };
  }
  const bullet = trimmed.match(/^(?:[-*]\s+)?([A-Za-z0-9._\-]+(?:\[[^\]]+\])?)$/);
  if (bullet?.[1]) {
    return { id: bullet[1], label: bullet[1] };
  }
  return null;
}

export function parseCursorModelsOutput(raw: string): CursorModelOption[] {
  if (isEmptyCursorModelsListing(raw)) {
    return [];
  }
  const options: CursorModelOption[] = [];
  const seen = new Set<string>();
  for (const line of String(raw || "").split(/\r?\n/)) {
    const parsed = parseCursorModelLine(line);
    if (!parsed) {
      continue;
    }
    const key = parsed.id.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    options.push(parsed);
  }
  return enrichCursorModelsForContext(pinAutoFirst(options));
}

export function pinAutoFirst(options: CursorModelOption[]): CursorModelOption[] {
  const auto: CursorModelOption[] = [];
  const rest: CursorModelOption[] = [];
  for (const option of options) {
    if (option.id.toLowerCase() === "auto") {
      auto.push(option);
    } else {
      rest.push(option);
    }
  }
  return [...auto, ...rest];
}

/** Normalize context tokens like 1m / 300k / 272K for comparisons. */
export function normalizeCursorContextToken(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const cleaned = String(raw).trim().toLowerCase().replace(/\s+/g, "");
  if (!cleaned) {
    return null;
  }
  if (cleaned === "1m" || cleaned === "1000k") {
    return "1m";
  }
  const match = cleaned.match(/^(\d+)k$/);
  if (match) {
    return `${match[1]}k`;
  }
  return cleaned;
}

/** Drop any context token (1M / 256K) and collapse whitespace for comparison. */
function stripContextForCompare(label: string): string {
  return label
    .toLowerCase()
    .replace(/\b(1\s*m|\d+\s*k)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the catalog label and cursor-agent system.init model string refer
 * to the same selection.
 *
 * cursor-agent's `system.init.model` is a display name and often carries a
 * context token (e.g. `Grok 4.7 256K Medium`) that the flat `--list-models`
 * label omits (`Grok 4.7  Medium`). We therefore compare the labels with the
 * context token removed, and only enforce the window when the requested model
 * id explicitly asked for one via a `context=` bracket override.
 */
export function cursorModelLabelsMatch(
  expectedLabel: string,
  reportedLabel: string,
  modelId?: string,
): boolean {
  const expected = expectedLabel.trim().toLowerCase();
  const reported = reportedLabel.trim().toLowerCase();
  if (!expected || !reported) {
    return true;
  }
  if (expected === reported) {
    return true;
  }

  // A parameterized id with context= pins a specific window. The CLI's display
  // label and the catalog label often use different effort/thinking wording
  // (e.g. catalog `... 1M Thinking` vs init `... 1M High`), so when the window
  // is explicitly requested, matching it is sufficient to confirm the model.
  const requestedContext = modelId
    ? normalizeCursorContextToken(modelId.match(/\[(?:[^\]]*?\b)?context=([^,\]]+)/i)?.[1])
    : null;
  if (requestedContext) {
    const reportedContext = normalizeCursorContextToken(
      reported.match(/\b(1\s*m|\d+\s*k)\b/i)?.[1],
    );
    return reportedContext ? reportedContext === requestedContext : true;
  }

  // Flat slug: compare the non-context remainder. The CLI label may add a
  // context token the catalog listing does not carry, so ignore it here.
  return stripContextForCompare(expected) === stripContextForCompare(reported);
}
