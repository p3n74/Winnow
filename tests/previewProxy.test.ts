import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  isLoopbackHostname,
  isValidPreviewPort,
  isWinnowReservedPath,
  listLoopbackConnectTargets,
  parseBrowseAddress,
  parsePreviewPrefix,
  parsePreviewPortFromReferer,
  previewIframeSrc,
  probeLoopbackPort,
  proxyPreviewHttp,
  resolvePreviewTarget,
  rewritePreviewHtml,
  rewritePreviewLocation,
  stripFrameBlockingHeaders,
  stripMatchingTokenQuery,
  isRetryablePreviewConnectError,
  LOOPBACK_CONNECT_HOSTS,
} from "../src/cli/ui/previewProxy.js";

const closeServer = (server: ReturnType<typeof createServer> | undefined): Promise<void> =>
  new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });

describe("preview target parsing", () => {
  it("parses /__preview/:port paths", () => {
    expect(parsePreviewPrefix("/__preview/5173")).toEqual({ port: 5173, path: "/" });
    expect(parsePreviewPrefix("/__preview/5173/")).toEqual({ port: 5173, path: "/" });
    expect(parsePreviewPrefix("/__preview/3000/@vite/client")).toEqual({ port: 3000, path: "/@vite/client" });
    expect(parsePreviewPrefix("/api/health")).toBeNull();
  });

  it("reads the preview port from Referer for root-absolute SPA assets", () => {
    expect(parsePreviewPortFromReferer("http://192.168.1.9:3210/__preview/5173/")).toBe(5173);
    expect(parsePreviewPortFromReferer("http://example/main")).toBeNull();
  });

  it("does not steal Winnow routes for referer-sticky proxying", () => {
    expect(isWinnowReservedPath("/")).toBe(true);
    expect(isWinnowReservedPath("/main")).toBe(true);
    expect(isWinnowReservedPath("/api/agent/running")).toBe(true);
    expect(isWinnowReservedPath("/@vite/client")).toBe(false);
  });

  it("resolves prefix first, then referer, and skips the Winnow listen port", () => {
    const prefixed = resolvePreviewTarget(
      new URL("http://127.0.0.1:3210/__preview/5173/app"),
      {},
      3210,
    );
    expect(prefixed).toEqual({ port: 5173, path: "/app" });

    const sticky = resolvePreviewTarget(
      new URL("http://127.0.0.1:3210/@vite/client"),
      { referer: "http://127.0.0.1:3210/__preview/5173/" },
      3210,
    );
    expect(sticky).toEqual({ port: 5173, path: "/@vite/client" });

    expect(
      resolvePreviewTarget(
        new URL("http://127.0.0.1:3210/__preview/3001/?token=secret&keep=1"),
        {},
        3210,
        "secret",
      ),
    ).toEqual({ port: 3001, path: "/?keep=1" });

    const reserved = resolvePreviewTarget(
      new URL("http://127.0.0.1:3210/api/health"),
      { referer: "http://127.0.0.1:3210/__preview/5173/" },
      3210,
    );
    expect(reserved).toBeNull();

    expect(resolvePreviewTarget(new URL("http://127.0.0.1:3210/__preview/3210/"), {}, 3210)).toBeNull();
  });
});

describe("browse address", () => {
  it("accepts loopback URLs and rejects other hosts", () => {
    expect(parseBrowseAddress("http://127.0.0.1:5173").ok).toBe(true);
    expect(parseBrowseAddress("localhost:3000").ok).toBe(true);
    expect(parseBrowseAddress("https://example.com").ok).toBe(false);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("0.0.0.0")).toBe(true);
    expect(isLoopbackHostname("example.com")).toBe(false);
    expect(isValidPreviewPort(80)).toBe(true);
    expect(isValidPreviewPort(3210, 3210)).toBe(false);
  });

  it("always uses a same-origin /__preview path (Chrome cannot iframe localhost)", () => {
    expect(previewIframeSrc("http://127.0.0.1:5173/")).toBe("/__preview/5173/");
    expect(previewIframeSrc("http://127.0.0.1:5173/app")).toBe("/__preview/5173/app");
    expect(previewIframeSrc("http://localhost:3001/")).toBe("/__preview/3001/");
  });
});

describe("preview connect retry", () => {
  it("retries ECONNREFUSED so Vite's localhost/::1 bind can be reached", async () => {
    expect(isRetryablePreviewConnectError({ code: "ECONNREFUSED" })).toBe(true);
    expect(isRetryablePreviewConnectError({ code: "EPERM" })).toBe(false);
    expect(LOOPBACK_CONNECT_HOSTS[0]).toBe("localhost");
    const targets = await listLoopbackConnectTargets();
    expect(targets.some((t) => t.address === "127.0.0.1" && t.family === 4)).toBe(true);
    expect(targets.some((t) => t.address === "::1" && t.family === 6)).toBe(true);
  });
});

describe("preview response rewriting", () => {
  it("strips frame-blocking headers and rewrites loopback Location", () => {
    const headers = stripFrameBlockingHeaders({
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
      "content-type": "text/html",
    });
    expect(headers["x-frame-options"]).toBeUndefined();
    expect(String(headers["content-security-policy"] || "")).not.toMatch(/frame-ancestors/i);
    expect(headers["content-type"]).toBe("text/html");
    expect(rewritePreviewLocation("http://127.0.0.1:5173/login", 5173)).toBe("/__preview/5173/login");
    expect(rewritePreviewLocation("https://example.com/x", 5173)).toBe("https://example.com/x");
    expect(rewritePreviewHtml(`<script src="http://localhost:5173/@vite/client"></script>`, 5173)).toBe(
      `<script src="/__preview/5173/@vite/client"></script>`,
    );
  });
});

describe("stripMatchingTokenQuery", () => {
  it("removes only the Winnow access token from forwarded query strings", () => {
    expect(stripMatchingTokenQuery("?token=secret&keep=1", "secret")).toBe("?keep=1");
    expect(stripMatchingTokenQuery("?token=other", "secret")).toBe("?token=other");
    expect(stripMatchingTokenQuery("", "secret")).toBe("");
  });
});

describe("preview HTTP proxy integration", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  });

  async function listen(host: string): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
    const server = createServer((req, res) => {
      res.setHeader("x-frame-options", "DENY");
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(
        `<html><body>vite-ok host=${req.headers.host} url=${req.url} src="http://localhost:PLACEHOLDER/@vite/client"</body></html>`.replace(
          "PLACEHOLDER",
          String((server.address() as AddressInfo).port),
        ),
      );
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, host, () => resolve());
    });
    servers.push(server);
    return { server, port: (server.address() as AddressInfo).port };
  }

  async function listenProxy(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const target = resolvePreviewTarget(url, req.headers, 3210);
      if (!target) {
        res.statusCode = 404;
        res.end("no-preview");
        return;
      }
      proxyPreviewHttp(req, res, target);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    servers.push(server);
    return { server, port: (server.address() as AddressInfo).port };
  }

  it("proxies GET to a 127.0.0.1 server, strips XFO, and rewrites localhost URLs", async () => {
    const upstream = await listen("127.0.0.1");
    const proxy = await listenProxy();
    const res = await fetch(`http://127.0.0.1:${proxy.port}/__preview/${upstream.port}/`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(body).toContain("vite-ok");
    expect(body).toContain(`host=localhost:${upstream.port}`);
    expect(body).toContain(`/__preview/${upstream.port}/@vite/client`);
    expect(body).not.toContain(`http://localhost:${upstream.port}/@vite/client`);
  });

  it("reaches an IPv6-only ::1 listener after 127.0.0.1 refuses", async () => {
    let upstream: { server: ReturnType<typeof createServer>; port: number };
    try {
      upstream = await listen("::1");
    } catch {
      return;
    }
    const proxy = await listenProxy();
    const res = await fetch(`http://127.0.0.1:${proxy.port}/__preview/${upstream.port}/`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain("vite-ok");
    expect(body).toContain(`host=localhost:${upstream.port}`);
  });

  it("returns a 200 error page when nothing is listening", async () => {
    const proxy = await listenProxy();
    const res = await fetch(`http://127.0.0.1:${proxy.port}/__preview/59999/`);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain("Preview unavailable");
    expect(body).toContain("59999");
  });

  it("probe reports listening on 127.0.0.1", async () => {
    const upstream = await listen("127.0.0.1");
    const result = await probeLoopbackPort(upstream.port);
    expect(result.listening).toBe(true);
    expect(result.attempts.some((a) => a.ok && a.address === "127.0.0.1")).toBe(true);
  });
});
