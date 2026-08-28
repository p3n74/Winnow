import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { applySecurityHeaders, MAX_JSON_BODY_BYTES, readJsonBody, sendJson } from "../src/cli/ui/httpUtil.js";
import type { ServerResponse } from "node:http";

function fakeReq(chunks: string[], { error }: { error?: Error } = {}): EventEmitter {
  const req = new EventEmitter() as EventEmitter & {
    setEncoding: (enc: string) => void;
    destroy: () => void;
  };
  req.setEncoding = () => undefined;
  req.destroy = () => undefined;
  queueMicrotask(() => {
    if (error) {
      req.emit("error", error);
      return;
    }
    for (const c of chunks) {
      req.emit("data", c);
    }
    req.emit("end");
  });
  return req;
}

describe("readJsonBody", () => {
  it("parses a small object", async () => {
    const body = await readJsonBody(fakeReq(['{"a":1}']) as never);
    expect(body).toEqual({ a: 1 });
  });

  it("rejects oversize bodies", async () => {
    const chunk = "x".repeat(1000);
    const n = Math.ceil(MAX_JSON_BODY_BYTES / 1000) + 2;
    await expect(readJsonBody(fakeReq(Array.from({ length: n }, () => chunk)) as never)).rejects.toThrow(
      /exceeds/,
    );
  });
});

function fakeRes(): ServerResponse & { headers: Record<string, string>; body?: string } {
  const headers: Record<string, string> = {};
  return {
    headers,
    statusCode: 0,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers[name] = String(value);
      return this as ServerResponse;
    },
    end(chunk?: unknown) {
      if (typeof chunk === "string") {
        this.body = chunk;
      }
      return this as ServerResponse;
    },
  } as ServerResponse & { headers: Record<string, string>; body?: string };
}

describe("sendJson / applySecurityHeaders", () => {
  it("sets nosniff and no-store on JSON responses", () => {
    const res = fakeRes();
    sendJson(res, 200, { ok: true });
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toContain("application/json");
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("adds CORS headers when an origin is configured", () => {
    const res = fakeRes();
    applySecurityHeaders(res, { corsOrigin: "https://winnow.example.com" });
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("https://winnow.example.com");
    expect(res.headers["Access-Control-Allow-Headers"]).toContain("Authorization");
    expect(res.headers["Access-Control-Allow-Credentials"]).toBe("true");
  });

  it("omits CORS headers when no origin is set", () => {
    const res = fakeRes();
    applySecurityHeaders(res);
    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
