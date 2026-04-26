import { ExternalProvider } from "../config/providerRegistry.js";

export type SmokeTestResult = {
  ok: boolean;
  provider: ExternalProvider;
  status?: number;
  error?: string;
};

function authHeaders(provider: ExternalProvider, key: string): Record<string, string> {
  if (provider === "anthropic") {
    return {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    };
  }
  return {
    Authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
}

export async function smokeTestProvider(
  provider: ExternalProvider,
  apiKey: string,
  options?: { deepseekBaseUrl?: string },
): Promise<SmokeTestResult> {
  const key = apiKey.trim();
  if (!key) {
    return { ok: false, provider, error: "API key is missing." };
  }

  try {
    if (provider === "gemini") {
      const url =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
        encodeURIComponent(key);
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "ping" }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
      });
      if (!res.ok) {
        return { ok: false, provider, status: res.status, error: await res.text() };
      }
      return { ok: true, provider, status: res.status };
    }

    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: authHeaders(provider, key),
        body: JSON.stringify({
          model: "claude-3-5-haiku-latest",
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!res.ok) {
        return { ok: false, provider, status: res.status, error: await res.text() };
      }
      return { ok: true, provider, status: res.status };
    }

    const baseUrl =
      provider === "deepseek" ? (options?.deepseekBaseUrl?.trim() || "https://api.deepseek.com") : "https://api.openai.com";
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(provider, key),
      body: JSON.stringify({
        model: provider === "deepseek" ? "deepseek-v4-flash" : "gpt-4.1-mini",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
    });
    if (!res.ok) {
      return { ok: false, provider, status: res.status, error: await res.text() };
    }
    return { ok: true, provider, status: res.status };
  } catch (error) {
    return {
      ok: false,
      provider,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
