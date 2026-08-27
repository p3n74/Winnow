/**
 * Cursor `--output-format stream-json --stream-partial-output` emits three
 * assistant event shapes. Only deltas with timestamp_ms and no model_call_id
 * carry new text; the other two are duplicate flushes.
 * https://cursor.com/docs/cli/reference/output-format
 */
export function shouldAppendAssistantStreamEvent(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }
  const rec = data as Record<string, unknown>;
  if (rec.type !== "assistant") {
    return false;
  }
  const hasTimestamp = rec.timestamp_ms != null && rec.timestamp_ms !== "";
  const hasModelCallId = rec.model_call_id != null && rec.model_call_id !== "";
  return hasTimestamp && !hasModelCallId;
}

export function assistantTextFromStreamEvent(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "";
  }
  const rec = data as Record<string, unknown>;
  const message = rec.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return "";
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}
