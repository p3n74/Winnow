import { timingSafeEqual, randomBytes } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

export const UI_COOKIE_NAME = "winnow_ui";
export const UI_HEALTH_PATH = "/api/health";
export const UI_HEALTH_PAYLOAD = { ok: true, service: "winnow-ui" } as const;

export type AccessVia = "none" | "query" | "bearer" | "cookie";

export type AccessAuthResult = {
  ok: boolean;
  via: AccessVia;
};

export function isLoopbackBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

/** 32 hex chars (16 random bytes). Used for non-loopback auto tokens. */
export function generateAccessToken(): string {
  return randomBytes(16).toString("hex");
}

export function tokensMatch(expected: string, provided: string | undefined | null): boolean {
  if (!provided) {
    return false;
  }
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function parseCookieMap(cookieHeader: string | string[] | undefined): Record<string, string> {
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join("; ") : (cookieHeader ?? "");
  const out: Record<string, string> = {};
  if (!raw) {
    return out;
  }
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) {
      continue;
    }
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function parseBearerToken(authorization: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!raw) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)/i.exec(raw.trim());
  return match?.[1];
}

export function isForwardedHttps(headers: IncomingHttpHeaders): boolean {
  const proto = headers["x-forwarded-proto"];
  const value = Array.isArray(proto) ? proto[0] : proto;
  const first = (value ?? "").split(",")[0]?.trim().toLowerCase();
  return first === "https";
}

export function buildUiAccessCookie(token: string, secure: boolean): string {
  const parts = [
    `${UI_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function shouldSetAccessCookie(via: AccessVia): boolean {
  return via === "query" || via === "bearer";
}

export function isPublicHealthRequest(pathname: string, method: string | undefined): boolean {
  const m = (method ?? "GET").toUpperCase();
  return pathname === UI_HEALTH_PATH && (m === "GET" || m === "HEAD");
}

export function authorizeAccess(
  expectedToken: string | undefined,
  url: URL,
  headers: IncomingHttpHeaders,
): AccessAuthResult {
  if (!expectedToken) {
    return { ok: true, via: "none" };
  }
  const query = url.searchParams.get("token");
  if (tokensMatch(expectedToken, query)) {
    return { ok: true, via: "query" };
  }
  const bearer = parseBearerToken(headers.authorization);
  if (tokensMatch(expectedToken, bearer)) {
    return { ok: true, via: "bearer" };
  }
  const cookie = parseCookieMap(headers.cookie)[UI_COOKIE_NAME];
  if (tokensMatch(expectedToken, cookie)) {
    return { ok: true, via: "cookie" };
  }
  return { ok: false, via: "none" };
}

export type UiBindInput = {
  host?: string;
  token?: string;
  remote?: boolean;
  open?: boolean;
  desktopShell?: boolean;
};

export type UiBindResult = {
  host: string;
  token?: string;
  openBrowser: boolean;
  remote: boolean;
};

/**
 * Resolve bind host, access token, and browser launch for `winnow ui`.
 * `--remote` forces a non-loopback bind (default 0.0.0.0) and skips auto-open.
 */
export function resolveUiBindOptions(input: UiBindInput): UiBindResult {
  const remote = Boolean(input.remote);
  const requestedHost = (input.host ?? "127.0.0.1").trim() || "127.0.0.1";
  const host = remote && isLoopbackBindHost(requestedHost) ? "0.0.0.0" : requestedHost;
  let token = input.token?.trim() || undefined;
  if (!token && !isLoopbackBindHost(host)) {
    token = generateAccessToken();
  }
  const openBrowser = input.desktopShell ? false : remote ? false : (input.open ?? true);
  return { host, token, openBrowser, remote };
}
