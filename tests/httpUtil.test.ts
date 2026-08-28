import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { MAX_JSON_BODY_BYTES, readJsonBody } from "../src/cli/ui/httpUtil.js";

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
