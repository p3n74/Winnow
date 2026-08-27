export type CursorModelOption = {
  id: string;
  label: string;
};

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
  const dashed = trimmed.match(/^([A-Za-z0-9._-]+)\s+-\s+(.+?)\s*$/);
  if (dashed?.[1]) {
    let label = dashed[2] || dashed[1];
    label = label.replace(/\s*\((?:current|default)(?:,\s*(?:current|default))*\)\s*$/i, "").trim();
    return { id: dashed[1], label };
  }
  const bullet = trimmed.match(/^(?:[-*]\s+)?([A-Za-z0-9._-]+)$/);
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
  return pinAutoFirst(options);
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
