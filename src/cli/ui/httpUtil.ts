import { IncomingMessage, ServerResponse } from "node:http";

/** Reject JSON bodies larger than this to avoid unbounded `body += chunk` (audit F3). */
export const MAX_JSON_BODY_BYTES = 2_000_000;

export type SecurityHeaderOptions = {
  corsOrigin?: string;
};

export function applySecurityHeaders(res: ServerResponse, options: SecurityHeaderOptions = {}): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  const origin = options.corsOrigin?.trim();
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Vary", "Origin");
  }
}

export function applyNoStore(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store");
}

export function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  applyNoStore(res);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(data));
}

export function sendHandlerError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    try {
      res.end();
    } catch {
      // ignore
    }
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  sendJson(res, 500, { ok: false, error: message });
}

export function readJsonBody(req: IncomingMessage, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk, "utf8");
      if (size > maxBytes) {
        req.removeAllListeners("data");
        req.removeAllListeners("end");
        reject(new Error(`JSON body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}
