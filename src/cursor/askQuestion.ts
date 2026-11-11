export type AskOption = {
  id: string;
  label: string;
};

export type AskQuestionSpec = {
  id: string;
  prompt: string;
  allowMultiple: boolean;
  options: AskOption[];
};

export type PendingAskQuestion = {
  title?: string;
  questions: AskQuestionSpec[];
};

export type ParsedStreamQuestion = PendingAskQuestion & {
  key: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseAskQuestionArgs(params: unknown): PendingAskQuestion | null {
  const root = asRecord(params);
  if (!root) {
    return null;
  }
  const rawQuestions = Array.isArray(root.questions) ? root.questions : [];
  const questions: AskQuestionSpec[] = [];
  for (const item of rawQuestions) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const id = asString(row.id);
    const prompt = asString(row.prompt);
    const options: AskOption[] = [];
    if (Array.isArray(row.options)) {
      for (const option of row.options) {
        const opt = asRecord(option);
        if (!opt) {
          continue;
        }
        const optionId = asString(opt.id);
        const label = asString(opt.label) || optionId;
        if (optionId) {
          options.push({ id: optionId, label });
        }
      }
    }
    if (!id || !prompt || options.length === 0) {
      continue;
    }
    questions.push({
      id,
      prompt,
      allowMultiple: row.allowMultiple === true,
      options,
    });
  }
  if (questions.length === 0) {
    return null;
  }
  const title = asString(root.title);
  return title ? { title, questions } : { questions };
}

/**
 * Print mode emits the question, then immediately writes a synthetic
 * "Questions skipped" response. Capture the request so the UI can still ask.
 */
export function parseStreamAskQuestion(event: unknown): ParsedStreamQuestion | null {
  const root = asRecord(event);
  if (!root) {
    return null;
  }
  if (root.type === "interaction_query" && root.subtype === "request" && root.query_type === "askQuestionInteractionQuery") {
    const query = asRecord(root.query);
    const nested = asRecord(query?.askQuestionInteractionQuery);
    const args = asRecord(nested?.args);
    const parsed = parseAskQuestionArgs(args);
    if (!parsed) {
      return null;
    }
    const key = asString(nested?.toolCallId) || asString(query?.id) || JSON.stringify(parsed.questions.map((q) => q.id));
    return { ...parsed, key };
  }
  if (root.type === "tool_call" && root.subtype === "started") {
    const tool = asRecord(root.tool_call);
    const call = asRecord(tool?.askQuestionToolCall);
    const parsed = parseAskQuestionArgs(call?.args);
    if (!parsed) {
      return null;
    }
    const key = asString(call?.toolCallId) || asString(root.call_id) || JSON.stringify(parsed.questions.map((q) => q.id));
    return { ...parsed, key };
  }
  return null;
}
