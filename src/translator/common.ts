export type ProtectedBlocks = {
  text: string;
  placeholders: Map<string, string>;
};

const PROTECTED_PATTERNS: RegExp[] = [
  /```[\s\S]*?```/g,
  /`[^`\n]+`/g,
  /\{[\s\S]*?\}/g,
  /\b(?:[A-Za-z]:)?[./~]?[A-Za-z0-9._/-]+\.[A-Za-z0-9._-]+\b/g,
  /--?[a-zA-Z][a-zA-Z0-9-]*/g,
];

export function parseGlossary(glossary: string): string[] {
  if (!glossary.trim()) {
    return [];
  }

  return glossary
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function protectTechnicalBlocks(input: string): ProtectedBlocks {
  let text = input;
  const placeholders = new Map<string, string>();
  let index = 0;

  for (const pattern of PROTECTED_PATTERNS) {
    text = text.replace(pattern, (match) => {
      const token = `__WINNOW_KEEP_${index}__`;
      index += 1;
      placeholders.set(token, match);
      return token;
    });
  }

  return { text, placeholders };
}

export function restoreTechnicalBlocks(input: string, placeholders: Map<string, string>): string {
  let restored = input;
  for (const [token, original] of placeholders.entries()) {
    restored = restored.split(token).join(original);
  }
  return restored;
}

export interface Translator {
  translateInput(text: string): Promise<string>;
  translateOutput(text: string): Promise<string>;
}
