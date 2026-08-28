import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage, type RequestOptions, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

export const PREVIEW_PREFIX = "/__preview/";

export type PreviewTarget = {
  port: number;
  path: string;
};

export type LoopbackConnectTarget = {
  address: string;
  family: 4 | 6;
  label: string;
};

export type PreviewProbeAttempt = {
  label: string;
  address: string;
  family: 4 | 6;
  ok: boolean;
  status?: number;
  error?: string;
};

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const RESERVED_PREFIXES = ["/api/", "/ws/", "/main", "/agent", "/__preview/"];

/** Display order / docs. Actual connects use DNS-resolved loopback addresses. */
export const LOOPBACK_CONNECT_HOSTS = ["localhost", "127.0.0.1", "::1"] as const;

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "0.0.0.0";
}

export function isValidPreviewPort(port: number, winnowPort?: number): boolean {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return false;
  }
  if (winnowPort !== undefined && port === winnowPort) {
    return false;
  }
  return true;
}

export function isWinnowReservedPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/main" || pathname === "/agent" || pathname === "/api" || pathname === "/ws") {
    return true;
  }
  return RESERVED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function parsePreviewPrefix(pathname: string): PreviewTarget | null {
  const match = /^\/__preview\/(\d{1,5})(\/.*)?$/.exec(pathname);
  if (!match) {
    return null;
  }
  const port = Number(match[1]);
  if (!isValidPreviewPort(port)) {
    return null;
  }
  return { port, path: match[2] && match[2].length > 0 ? match[2] : "/" };
}

export function parsePreviewPortFromReferer(referer: string | string[] | undefined): number | null {
  const raw = Array.isArray(referer) ? referer[0] : referer;
  if (!raw) {
    return null;
  }
  try {
    const parsed = new URL(raw);
    return parsePreviewPrefix(parsed.pathname)?.port ?? null;
  } catch {
    return null;
  }
}

export function stripMatchingTokenQuery(search: string, token: string | undefined): string {
  if (!search) {
    return "";
  }
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (token && params.get("token") === token) {
    params.delete("token");
  }
  const next = params.toString();
  return next ? `?${next}` : "";
}

export function resolvePreviewTarget(
  url: URL,
  headers: IncomingMessage["headers"],
  winnowPort: number,
  accessToken?: string,
): PreviewTarget | null {
  const search = stripMatchingTokenQuery(url.search, accessToken);
  const prefixed = parsePreviewPrefix(url.pathname);
  if (prefixed) {
    if (!isValidPreviewPort(prefixed.port, winnowPort)) {
      return null;
    }
    return { port: prefixed.port, path: prefixed.path + search };
  }
  if (isWinnowReservedPath(url.pathname)) {
    return null;
  }
  const fromRef = parsePreviewPortFromReferer(headers.referer);
  if (fromRef && isValidPreviewPort(fromRef, winnowPort)) {
    return { port: fromRef, path: (url.pathname || "/") + search };
  }
  return null;
}

/** Parse an address-bar URL. Only loopback HTTP(S) targets are allowed. */
export function parseBrowseAddress(raw: string): { ok: true; href: string; port: number; path: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "enter a URL" };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
  } catch {
    return { ok: false, error: "invalid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "only http(s) URLs are allowed" };
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    return { ok: false, error: "preview is limited to localhost on this machine" };
  }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
  if (!isValidPreviewPort(port)) {
    return { ok: false, error: "invalid port" };
  }
  return {
    ok: true,
    href: parsed.href,
    port,
    path: (parsed.pathname || "/") + parsed.search,
  };
}

/**
 * Always same-origin. Cursor's Simple Browser is an Electron webview that can
 * hit localhost directly; a website cannot (Chrome Private Network Access).
 */
export function previewIframeSrc(href: string): string {
  const parsed = parseBrowseAddress(href);
  if (!parsed.ok) {
    return "about:blank";
  }
  const target = new URL(parsed.href);
  const rest = target.pathname + target.search;
  return `${PREVIEW_PREFIX}${parsed.port}${rest === "/" ? "/" : rest}${target.hash}`;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function copyForwardHeaders(
  source: IncomingMessage["headers"],
  extra: Record<string, string | number | string[] | undefined>,
): Record<string, string | number | string[] | undefined> {
  const out: Record<string, string | number | string[] | undefined> = { ...extra };
  for (const [key, value] of Object.entries(source)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "host" || lower === "accept-encoding") {
      continue;
    }
    if (lower === "cookie") {
      const filtered = String(value ?? "")
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part && !part.startsWith("winnow_ui="))
        .join("; ");
      if (filtered) {
        out.cookie = filtered;
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function stripFrameBlockingHeaders(
  headers: IncomingMessage["headers"],
): Record<string, string | number | string[] | undefined> {
  const out: Record<string, string | number | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "x-frame-options") {
      continue;
    }
    if (lower === "content-security-policy" || lower === "content-security-policy-report-only") {
      const next = String(value ?? "")
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part && !/^frame-ancestors\b/i.test(part))
        .join("; ");
      if (next) {
        out[key] = next;
      }
      continue;
    }
    if (lower === "location" && typeof value === "string") {
      out[key] = value;
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function rewritePreviewLocation(location: string, port: number): string {
  try {
    const target = new URL(location, `http://127.0.0.1:${port}`);
    if (!isLoopbackHostname(target.hostname)) {
      return location;
    }
    const targetPort = target.port ? Number(target.port) : 80;
    if (targetPort !== port) {
      return location;
    }
    return `${PREVIEW_PREFIX}${port}${target.pathname}${target.search}${target.hash}`;
  } catch {
    return location;
  }
}

export function rewritePreviewHtml(html: string, port: number): string {
  const dest = `${PREVIEW_PREFIX}${port}`;
  const origins = [
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    `http://[::1]:${port}`,
    `ws://localhost:${port}`,
    `ws://127.0.0.1:${port}`,
    `ws://[::1]:${port}`,
  ];
  let out = html;
  for (const origin of origins) {
    out = out.split(origin).join(dest);
  }
  return out;
}

export async function listLoopbackConnectTargets(): Promise<LoopbackConnectTarget[]> {
  const out: LoopbackConnectTarget[] = [];
  const seen = new Set<string>();
  const add = (address: string, family: 4 | 6, label: string): void => {
    const key = `${family}:${address}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push({ address, family, label });
  };
  try {
    const records = await dnsLookup("localhost", { all: true, verbatim: true });
    for (const rec of records) {
      const family: 4 | 6 = rec.family === 6 ? 6 : 4;
      add(rec.address, family, `localhost (${rec.address})`);
    }
  } catch {
    // fall through to hardcoded loopback
  }
  add("127.0.0.1", 4, "127.0.0.1");
  add("::1", 6, "::1");
  return out;
}

function bindLookup(address: string, family: 4 | 6): NonNullable<RequestOptions["lookup"]> {
  return ((_hostname, _options, callback) => {
    callback(null, address, family);
  }) as NonNullable<RequestOptions["lookup"]>;
}

function loopbackRequestOptions(
  target: LoopbackConnectTarget,
  port: number,
  path: string,
  method: string,
  headers: Record<string, string | number | string[] | undefined>,
): RequestOptions {
  return {
    hostname: target.address,
    port,
    path,
    method,
    family: target.family,
    headers: {
      ...headers,
      host: `localhost:${port}`,
      "accept-encoding": "identity",
    },
    lookup: bindLookup(target.address, target.family),
  };
}

export function isRetryablePreviewConnectError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String((error as NodeJS.ErrnoException).code) : "";
  return code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "EADDRNOTAVAIL";
}

function previewErrorPage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Winnow preview</title>
<style>body{font-family:ui-sans-serif,system-ui,sans-serif;background:#050505;color:#e5e7eb;padding:24px}
h1{font-size:16px;color:#67e8f9}p{color:#94a3b8;max-width:42rem;line-height:1.5}</style></head>
<body><h1>Preview unavailable</h1><p>${message.replace(/</g, "&lt;")}</p></body></html>`;
}

function writePreviewError(res: ServerResponse, port: number, tried: string, errors: string[]): void {
  if (res.headersSent) {
    try {
      res.end();
    } catch {
      // ignore
    }
    return;
  }
  const html = previewErrorPage(
    `Nothing is listening on port ${port} on this machine (tried ${tried}). ${errors.join("; ")}. Cursor's IDE browser is a desktop webview that can open localhost directly. This tab is a website, so Winnow reverse-proxies loopback on the PC that runs Winnow.`,
  );
  // 200 so Cloudflare does not replace this page with its own 502 interstitial.
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

function pipeOrRewritePreviewResponse(pRes: IncomingMessage, res: ServerResponse, port: number): void {
  const contentType = String(pRes.headers["content-type"] || "");
  const encoding = String(pRes.headers["content-encoding"] || "").toLowerCase();
  const outHeaders = stripFrameBlockingHeaders(pRes.headers);
  const location = headerValue(pRes.headers.location);
  if (location) {
    outHeaders.location = rewritePreviewLocation(location, port);
  }

  const canRewriteHtml = contentType.includes("text/html") && (!encoding || encoding === "identity");
  if (!canRewriteHtml) {
    res.writeHead(pRes.statusCode ?? 200, outHeaders);
    pRes.pipe(res);
    return;
  }

  const chunks: Buffer[] = [];
  pRes.on("data", (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  pRes.on("end", () => {
    const body = rewritePreviewHtml(Buffer.concat(chunks).toString("utf8"), port);
    delete outHeaders["content-length"];
    delete outHeaders["transfer-encoding"];
    res.writeHead(pRes.statusCode ?? 200, outHeaders);
    res.end(body);
  });
  pRes.on("error", () => {
    if (!res.headersSent) {
      res.statusCode = 502;
    }
    res.end();
  });
}

export async function probeLoopbackPort(port: number): Promise<{
  port: number;
  listening: boolean;
  attempts: PreviewProbeAttempt[];
}> {
  const targets = await listLoopbackConnectTargets();
  const attempts: PreviewProbeAttempt[] = [];
  for (const target of targets) {
    const attempt = await new Promise<PreviewProbeAttempt>((resolve) => {
      const req = httpRequest(loopbackRequestOptions(target, port, "/", "GET", {}), (res) => {
        res.resume();
        resolve({
          label: target.label,
          address: target.address,
          family: target.family,
          ok: true,
          status: res.statusCode,
        });
      });
      req.setTimeout(1500, () => {
        req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
      });
      req.on("error", (err) => {
        resolve({
          label: target.label,
          address: target.address,
          family: target.family,
          ok: false,
          error: err.message,
        });
      });
      req.end();
    });
    attempts.push(attempt);
  }
  return { port, listening: attempts.some((item) => item.ok), attempts };
}

export function proxyPreviewHttp(req: IncomingMessage, res: ServerResponse, target: PreviewTarget): void {
  void (async () => {
    const targets = await listLoopbackConnectTargets();
    const method = (req.method || "GET").toUpperCase();
    const canRetry = method === "GET" || method === "HEAD";
    const errors: string[] = [];

    for (let i = 0; i < targets.length; i += 1) {
      const host = targets[i]!;
      const last = i === targets.length - 1;
      const done = await new Promise<boolean>((resolve) => {
        const headers = copyForwardHeaders(req.headers, {});
        const pReq = httpRequest(
          loopbackRequestOptions(host, target.port, target.path || "/", method, headers),
          (pRes) => {
            pipeOrRewritePreviewResponse(pRes, res, target.port);
            resolve(true);
          },
        );
        pReq.setTimeout(15000, () => {
          pReq.destroy(Object.assign(new Error("preview connect timeout"), { code: "ETIMEDOUT" }));
        });
        pReq.on("error", (error) => {
          errors.push(`${host.label}: ${(error as Error).message}`);
          if (!last && canRetry && isRetryablePreviewConnectError(error)) {
            resolve(false);
            return;
          }
          writePreviewError(res, target.port, targets.map((item) => item.label).join(", "), errors);
          resolve(true);
        });
        if (method === "GET" || method === "HEAD") {
          pReq.end();
        } else {
          req.pipe(pReq);
        }
      });
      if (done) {
        return;
      }
    }
  })();
}

export function proxyPreviewWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  target: PreviewTarget,
): void {
  void (async () => {
    const targets = await listLoopbackConnectTargets();
    const errors: string[] = [];

    for (let i = 0; i < targets.length; i += 1) {
      const host = targets[i]!;
      const last = i === targets.length - 1;
      const done = await new Promise<boolean>((resolve) => {
        const headers = copyForwardHeaders(req.headers, {
          connection: headerValue(req.headers.connection) ?? "Upgrade",
          upgrade: headerValue(req.headers.upgrade) ?? "websocket",
        });
        const pReq = httpRequest(
          loopbackRequestOptions(host, target.port, target.path || "/", "GET", headers),
        );
        pReq.on("upgrade", (pRes, pSocket, pHead) => {
          const lines = [`HTTP/1.1 ${pRes.statusCode ?? 101} ${pRes.statusMessage ?? "Switching Protocols"}`];
          for (const [key, value] of Object.entries(pRes.headers)) {
            if (value === undefined) {
              continue;
            }
            const rendered = Array.isArray(value) ? value.join(", ") : String(value);
            lines.push(`${key}: ${rendered}`);
          }
          socket.write(`${lines.join("\r\n")}\r\n\r\n`);
          if (head.length) {
            pSocket.write(head);
          }
          if (pHead.length) {
            socket.write(pHead);
          }
          pSocket.pipe(socket);
          socket.pipe(pSocket);
          resolve(true);
        });
        pReq.on("error", (error) => {
          errors.push(`${host.label}: ${(error as Error).message}`);
          if (!last && isRetryablePreviewConnectError(error)) {
            resolve(false);
            return;
          }
          try {
            socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
          } catch {
            // ignore
          }
          socket.destroy();
          resolve(true);
        });
        pReq.end();
      });
      if (done) {
        return;
      }
    }
  })();
}
