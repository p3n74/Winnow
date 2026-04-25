import { WinnowConfig } from "../config/schema.js";

/**
 * DeepSeek documents {@link https://api-docs.deepseek.com/ } POST /chat/completions
 * on base https://api.deepseek.com. Some proxies/SDKs use /v1/chat/completions instead.
 */
export function deepseekChatCompletionCandidates(baseUrl: string): string[] {
  const raw = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(raw)) {
    return [raw];
  }
  if (/\/v1$/i.test(raw)) {
    return [`${raw}/chat/completions`];
  }
  const out: string[] = [`${raw}/chat/completions`];
  try {
    const origin = new URL(raw).origin;
    const v1 = `${origin}/v1/chat/completions`;
    if (!out.includes(v1)) {
      out.push(v1);
    }
  } catch {
    // invalid URL: keep single candidate
  }
  return out;
}

export type DeepseekSmokeResult = {
  ok: boolean;
  attemptedUrls: string[];
  lastStatus: number;
  lastUrl: string;
  lastBodySnippet: string;
  error?: string;
};

/** Minimal chat completion to verify API key, model, and URL. Tries /chat/completions then /v1/chat/completions on 404. */
export async function smokeTestDeepseekChat(
  config: WinnowConfig,
  timeoutMs = 15000,
): Promise<DeepseekSmokeResult> {
  const key = config.deepseekApiKey?.trim();
  if (!key) {
    return {
      ok: false,
      attemptedUrls: [],
      lastStatus: 0,
      lastUrl: "",
      lastBodySnippet: "",
      error: "DeepSeek API key missing",
    };
  }

  const urls = deepseekChatCompletionCandidates(config.deepseekBaseUrl);
  const attempted: string[] = [];
  let lastStatus = 0;
  let lastUrl = "";
  let lastBodySnippet = "";

  for (const url of urls) {
    attempted.push(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: config.deepseekModel,
          messages: [{ role: "user", content: "Reply with the single word: OK" }],
          max_tokens: 8,
          stream: false,
        }),
      });
      const text = await res.text();
      lastStatus = res.status;
      lastUrl = url;
      lastBodySnippet = text.trim().slice(0, 800);
      if (res.ok) {
        return { ok: true, attemptedUrls: attempted, lastStatus, lastUrl, lastBodySnippet };
      }
      if (res.status === 404) {
        continue;
      }
      return {
        ok: false,
        attemptedUrls: attempted,
        lastStatus,
        lastUrl,
        lastBodySnippet,
        error: `HTTP ${res.status}`,
      };
    } catch (e) {
      const msg = (e as Error).message;
      return {
        ok: false,
        attemptedUrls: attempted,
        lastStatus: 0,
        lastUrl: url,
        lastBodySnippet: msg,
        error: msg,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    attemptedUrls: attempted,
    lastStatus,
    lastUrl,
    lastBodySnippet,
    error:
      lastStatus === 404
        ? "All candidate URLs returned 404. Set DEEPSEEK_BASE_URL to https://api.deepseek.com (or a full .../chat/completions URL)."
        : `HTTP ${lastStatus}`,
  };
}
