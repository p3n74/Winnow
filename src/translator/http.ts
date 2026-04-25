type FetchJsonOptions = {
  timeoutMs: number;
  retries: number;
  retryDelayMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJsonWithRetry<T>(
  input: string,
  init: RequestInit,
  options: FetchJsonOptions,
): Promise<T> {
  const retryDelayMs = options.retryDelayMs ?? 250;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error as Error;
      if (attempt < options.retries) {
        await sleep(retryDelayMs * (attempt + 1));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Request failed after retries: ${lastError?.message ?? "unknown error"}`);
}
