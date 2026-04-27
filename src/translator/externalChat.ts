import { ExternalProvider } from "../config/providerRegistry.js";

export type ExternalChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function runExternalChatCompletion(input: {
  provider: ExternalProvider;
  model: string;
  apiKey: string;
  messages: ExternalChatMessage[];
  deepseekBaseUrl?: string;
  universalBaseUrl?: string;
}): Promise<string> {
  const provider = input.provider;
  const model = input.model.trim();
  const key = input.apiKey.trim();
  if (!model) {
    throw new Error("Model is required.");
  }
  if (!key) {
    throw new Error(`API key is missing for ${provider}.`);
  }

  if (provider === "anthropic") {
    const system = input.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const messages = input.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1400,
        ...(system ? { system } : {}),
        messages,
      }),
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const body = (await res.json()) as { content?: Array<{ text?: string }> };
    return body.content?.map((c) => c.text || "").join("") || "";
  }

  if (provider === "gemini") {
    const contents = input.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    const system = input.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=` +
      encodeURIComponent(key);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        generationConfig: { maxOutputTokens: 1400 },
      }),
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return body.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  }

  const isDeepseek = provider === "deepseek";
  const isUniversal = provider === "universal";
  const baseUrl = isDeepseek
    ? (input.deepseekBaseUrl?.trim() || "https://api.deepseek.com")
    : isUniversal
      ? (input.universalBaseUrl?.trim() || "")
      : "https://api.openai.com";
  if (isUniversal && !baseUrl) {
    throw new Error("Universal adapter is missing base URL. Re-save it in Settings.");
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: input.messages,
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return body.choices?.[0]?.message?.content || "";
}
