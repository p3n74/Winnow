import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  debugPortFromDevtoolsUrl,
  findChromeExecutable,
  HostChromePreview,
  parseDevtoolsListening,
} from "../src/cli/ui/chromePreview.js";

describe("chrome preview helpers", () => {
  it("parses Chrome DevTools listening lines", () => {
    expect(
      parseDevtoolsListening("DevTools listening on ws://127.0.0.1:9222/devtools/browser/abc\n"),
    ).toBe("ws://127.0.0.1:9222/devtools/browser/abc");
    expect(debugPortFromDevtoolsUrl("ws://127.0.0.1:9222/devtools/browser/abc")).toBe(9222);
    expect(parseDevtoolsListening("not chrome")).toBeNull();
  });

  it("finds a Chrome-like binary when the path exists", () => {
    expect(
      findChromeExecutable("darwin", (path) => path.endsWith("Google Chrome")),
    ).toBe("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    expect(findChromeExecutable("darwin", () => false)).toBeNull();
  });
});

describe("host Chromium screencast", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];
  let chrome: HostChromePreview | undefined;

  afterEach(async () => {
    await chrome?.close().catch(() => undefined);
    chrome = undefined;
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
  });

  it("renders a loopback HTML page through headless Chrome", async () => {
    const chromePath = findChromeExecutable();
    if (!chromePath) {
      return;
    }
    const upstream = createServer((_req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end("<!doctype html><html><body><h1>chromium-ok</h1></body></html>");
    });
    await new Promise<void>((resolve, reject) => {
      upstream.once("error", reject);
      upstream.listen(0, "127.0.0.1", () => resolve());
    });
    servers.push(upstream);
    const port = (upstream.address() as AddressInfo).port;

    chrome = await HostChromePreview.tryLaunch(chromePath);
    const frames: string[] = [];
    chrome.onFrame((frame) => {
      frames.push(frame.data);
    });
    await chrome.navigate(`http://127.0.0.1:${port}/`);
    const started = Date.now();
    while (frames.length === 0 && Date.now() - started < 12000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]?.length).toBeGreaterThan(100);
  }, 25000);
});
