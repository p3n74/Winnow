import { describe, expect, it } from "vitest";
import type { IncomingHttpHeaders } from "node:http";
import {
  authorizeAccess,
  buildUiAccessCookie,
  generateAccessToken,
  isForwardedHttps,
  isLoopbackBindHost,
  isPublicHealthRequest,
  parseBearerToken,
  parseCookieMap,
  resolveUiBindOptions,
  shouldSetAccessCookie,
  tokensMatch,
  UI_COOKIE_NAME,
  UI_HEALTH_PATH,
} from "../src/cli/ui/accessAuth.js";

function urlWith(path: string): URL {
  return new URL(path, "http://127.0.0.1:3210");
}

describe("isLoopbackBindHost", () => {
  it("treats localhost aliases as loopback", () => {
    expect(isLoopbackBindHost("127.0.0.1")).toBe(true);
    expect(isLoopbackBindHost("localhost")).toBe(true);
    expect(isLoopbackBindHost("::1")).toBe(true);
  });

  it("treats wildcard and LAN hosts as non-loopback", () => {
    expect(isLoopbackBindHost("0.0.0.0")).toBe(false);
    expect(isLoopbackBindHost("192.168.1.10")).toBe(false);
  });
});

describe("tokensMatch", () => {
  it("accepts equal strings and rejects mismatches and missing values", () => {
    expect(tokensMatch("abc", "abc")).toBe(true);
    expect(tokensMatch("abc", "abd")).toBe(false);
    expect(tokensMatch("abc", "ab")).toBe(false);
    expect(tokensMatch("abc", undefined)).toBe(false);
  });
});

describe("parseCookieMap / parseBearerToken", () => {
  it("parses the winnow cookie among others", () => {
    const map = parseCookieMap(`other=1; ${UI_COOKIE_NAME}=secret%21; keep=yes`);
    expect(map[UI_COOKIE_NAME]).toBe("secret!");
    expect(map.other).toBe("1");
  });

  it("reads Bearer tokens case-insensitively", () => {
    expect(parseBearerToken("Bearer abc")).toBe("abc");
    expect(parseBearerToken("bearer xyz")).toBe("xyz");
    expect(parseBearerToken("Basic abc")).toBeUndefined();
  });
});

describe("authorizeAccess", () => {
  const token = "s3cret-token";

  it("allows all requests when no token is configured", () => {
    expect(authorizeAccess(undefined, urlWith("/"), {})).toEqual({ ok: true, via: "none" });
  });

  it("accepts query, Bearer, and cookie presentations", () => {
    expect(authorizeAccess(token, urlWith("/?token=s3cret-token"), {})).toEqual({ ok: true, via: "query" });
    expect(authorizeAccess(token, urlWith("/"), { authorization: "Bearer s3cret-token" })).toEqual({
      ok: true,
      via: "bearer",
    });
    const headers: IncomingHttpHeaders = { cookie: `${UI_COOKIE_NAME}=s3cret-token` };
    expect(authorizeAccess(token, urlWith("/"), headers)).toEqual({ ok: true, via: "cookie" });
  });

  it("rejects a mismatched token", () => {
    expect(authorizeAccess(token, urlWith("/?token=nope"), {})).toEqual({ ok: false, via: "none" });
    expect(authorizeAccess(token, urlWith("/"), { authorization: "Bearer nope" }).ok).toBe(false);
    expect(authorizeAccess(token, urlWith("/"), { cookie: `${UI_COOKIE_NAME}=nope` }).ok).toBe(false);
    expect(authorizeAccess(token, urlWith("/"), {}).ok).toBe(false);
  });

  it("prefers query over Bearer when both are valid (for Set-Cookie)", () => {
    expect(
      authorizeAccess(token, urlWith("/?token=s3cret-token"), { authorization: "Bearer s3cret-token" }).via,
    ).toBe("query");
  });
});

describe("access cookie", () => {
  it("sets Secure only when X-Forwarded-Proto is https", () => {
    expect(isForwardedHttps({ "x-forwarded-proto": "https" })).toBe(true);
    expect(isForwardedHttps({ "x-forwarded-proto": "https, http" })).toBe(true);
    expect(isForwardedHttps({ "x-forwarded-proto": "http" })).toBe(false);
    expect(isForwardedHttps({})).toBe(false);

    const insecure = buildUiAccessCookie("tok", false);
    expect(insecure).toContain(`${UI_COOKIE_NAME}=tok`);
    expect(insecure).toContain("HttpOnly");
    expect(insecure).toContain("SameSite=Lax");
    expect(insecure).not.toContain("Secure");

    expect(buildUiAccessCookie("tok", true)).toContain("Secure");
  });

  it("sets the cookie after query or Bearer auth, not cookie-only", () => {
    expect(shouldSetAccessCookie("query")).toBe(true);
    expect(shouldSetAccessCookie("bearer")).toBe(true);
    expect(shouldSetAccessCookie("cookie")).toBe(false);
    expect(shouldSetAccessCookie("none")).toBe(false);
  });
});

describe("isPublicHealthRequest", () => {
  it("allows GET and HEAD on /api/health only", () => {
    expect(isPublicHealthRequest(UI_HEALTH_PATH, "GET")).toBe(true);
    expect(isPublicHealthRequest(UI_HEALTH_PATH, "HEAD")).toBe(true);
    expect(isPublicHealthRequest(UI_HEALTH_PATH, "POST")).toBe(false);
    expect(isPublicHealthRequest("/api/system", "GET")).toBe(false);
  });
});

describe("resolveUiBindOptions", () => {
  it("keeps loopback bind and no auto token by default", () => {
    const bind = resolveUiBindOptions({});
    expect(bind.host).toBe("127.0.0.1");
    expect(bind.token).toBeUndefined();
    expect(bind.openBrowser).toBe(true);
    expect(bind.remote).toBe(false);
  });

  it("generates a 32-hex token for non-loopback binds", () => {
    const bind = resolveUiBindOptions({ host: "0.0.0.0" });
    expect(bind.host).toBe("0.0.0.0");
    expect(bind.token).toMatch(/^[0-9a-f]{32}$/);
    expect(bind.openBrowser).toBe(true);
  });

  it("forces 0.0.0.0, a token, and no auto-open in --remote", () => {
    const bind = resolveUiBindOptions({ remote: true });
    expect(bind.host).toBe("0.0.0.0");
    expect(bind.token).toMatch(/^[0-9a-f]{32}$/);
    expect(bind.openBrowser).toBe(false);
    expect(bind.remote).toBe(true);
  });

  it("keeps an explicit non-loopback --host with --remote", () => {
    const bind = resolveUiBindOptions({ remote: true, host: "10.0.0.5", token: "fixed" });
    expect(bind.host).toBe("10.0.0.5");
    expect(bind.token).toBe("fixed");
    expect(bind.openBrowser).toBe(false);
  });

  it("honors --no-open and --shell", () => {
    expect(resolveUiBindOptions({ open: false }).openBrowser).toBe(false);
    expect(resolveUiBindOptions({ desktopShell: true }).openBrowser).toBe(false);
  });

  it("skips token generation when --no-token is set", () => {
    const remote = resolveUiBindOptions({ remote: true, noToken: true });
    expect(remote.host).toBe("0.0.0.0");
    expect(remote.token).toBeUndefined();
    expect(remote.openBrowser).toBe(false);

    const lan = resolveUiBindOptions({ host: "0.0.0.0", noToken: true, token: "ignored" });
    expect(lan.token).toBeUndefined();
  });
});

describe("generateAccessToken", () => {
  it("returns 32 hex characters", () => {
    expect(generateAccessToken()).toMatch(/^[0-9a-f]{32}$/);
  });
});
