import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { parseBrowseAddress } from "./previewProxy.js";

export type ChromeFrameMetadata = {
  offsetTop?: number;
  pageScaleFactor?: number;
  deviceWidth: number;
  deviceHeight: number;
  scrollOffsetX?: number;
  scrollOffsetY?: number;
};

export type ChromeFrame = {
  data: string;
  metadata: ChromeFrameMetadata;
};

type CdpPending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const DEVTOOLS_RE = /DevTools listening on (ws:\/\/[^\s]+)/;

export function parseDevtoolsListening(chunk: string): string | null {
  const match = DEVTOOLS_RE.exec(chunk);
  return match?.[1] ?? null;
}

export function debugPortFromDevtoolsUrl(wsUrl: string): number | null {
  try {
    const parsed = new URL(wsUrl);
    const port = Number(parsed.port);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export function chromeExecutableCandidates(platformName = process.platform): string[] {
  const fromEnv = process.env.CHROME_PATH?.trim();
  const extra = fromEnv ? [fromEnv] : [];
  if (platformName === "darwin") {
    return [
      ...extra,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
  }
  if (platformName === "win32") {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || "";
    return [
      ...extra,
      join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      join(local, "Google", "Chrome", "Application", "chrome.exe"),
      join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
    ];
  }
  return [
    ...extra,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/microsoft-edge",
    "/snap/bin/chromium",
  ];
}

export function findChromeExecutable(
  platformName = process.platform,
  exists: (path: string) => boolean = existsSync,
): string | null {
  for (const candidate of chromeExecutableCandidates(platformName)) {
    if (candidate && exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<number, CdpPending>();
  private readonly ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.on("message", (raw) => {
      let msg: { id?: number; error?: { message?: string }; result?: unknown; method?: string; params?: unknown };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (typeof msg.id === "number") {
        const pending = this.pending.get(msg.id);
        if (!pending) {
          return;
        }
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.error) {
          pending.reject(new Error(msg.error.message || "CDP error"));
          return;
        }
        pending.resolve(msg.result);
        return;
      }
      if (msg.method) {
        this.onEvent?.(msg.method, msg.params);
      }
    });
  }

  onEvent: ((method: string, params: unknown) => void) | undefined;

  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(params ? { id, method, params } : { id, method }));
    });
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("CDP closed"));
    }
    this.pending.clear();
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

async function waitForWebSocket(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP websocket timeout")), 10000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return ws;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    throw new Error(`${url} HTTP ${res.status}`);
  }
  return res.json();
}

type JsonTarget = { type?: string; webSocketDebuggerUrl?: string };

async function pageWebSocketUrl(debugPort: number): Promise<string> {
  const listUrl = `http://127.0.0.1:${debugPort}/json/list`;
  for (let i = 0; i < 20; i += 1) {
    try {
      const list = (await fetchJson(listUrl)) as JsonTarget[];
      const page = Array.isArray(list)
        ? list.find((item) => item.type === "page" && item.webSocketDebuggerUrl)
        : undefined;
      if (page?.webSocketDebuggerUrl) {
        return page.webSocketDebuggerUrl;
      }
    } catch {
      // Chrome may not bind HTTP yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Chrome opened but no page target was listed");
}

export class HostChromePreview {
  private constructor(
    readonly chromePath: string,
    private readonly child: ChildProcess,
    private readonly userDataDir: string,
    private readonly cdp: CdpConnection,
    private readonly debugPort: number,
  ) {}

  private frameHandler: ((frame: ChromeFrame) => void) | undefined;
  private lastMeta: ChromeFrameMetadata = { deviceWidth: 1280, deviceHeight: 800 };
  private viewport = { width: 1280, height: 800 };

  static async tryLaunch(chromePath = findChromeExecutable()): Promise<HostChromePreview> {
    if (!chromePath) {
      throw new Error("Chrome/Chromium is not installed on this machine");
    }
    const userDataDir = await mkdtemp(join(tmpdir(), "winnow-chrome-"));
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--mute-audio",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ];
    const child = spawn(chromePath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let combined = "";
    const wsUrl = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        fn();
      };
      const timer = setTimeout(() => {
        finish(() => reject(new Error("Chrome did not print a DevTools websocket (timeout)")));
      }, 15000);
      const onData = (buf: Buffer): void => {
        combined += buf.toString("utf8");
        const found = parseDevtoolsListening(combined);
        if (found) {
          clearTimeout(timer);
          child.stdout?.off("data", onData);
          child.stderr?.off("data", onData);
          finish(() => resolve(found));
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        finish(() =>
          reject(new Error(`Chrome exited during launch (code=${code} signal=${signal}). ${combined.slice(-400)}`)),
        );
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        finish(() => reject(error));
      });
    });

    const debugPort = debugPortFromDevtoolsUrl(wsUrl);
    if (!debugPort) {
      child.kill("SIGKILL");
      throw new Error(`Could not parse Chrome debug port from ${wsUrl}`);
    }

    try {
      const pageWsUrl = await pageWebSocketUrl(debugPort);
      const pageWs = await waitForWebSocket(pageWsUrl);
      const cdp = new CdpConnection(pageWs);
      const session = new HostChromePreview(chromePath, child, userDataDir, cdp, debugPort);
      cdp.onEvent = (method, params) => {
        session.handleEvent(method, params);
      };
      await cdp.send("Page.enable");
      await cdp.send("Runtime.enable");
      await session.setViewport(1280, 800);
      await cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 55,
        maxWidth: 1280,
        maxHeight: 800,
        everyNthFrame: 1,
      });
      child.on("exit", () => {
        void session.cleanupFiles();
      });
      return session;
    } catch (error) {
      child.kill("SIGKILL");
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  onFrame(handler: (frame: ChromeFrame) => void): void {
    this.frameHandler = handler;
  }

  private handleEvent(method: string, params: unknown): void {
    if (method !== "Page.screencastFrame" || !params || typeof params !== "object") {
      return;
    }
    const frame = params as { data?: string; sessionId?: number; metadata?: ChromeFrameMetadata };
    if (typeof frame.sessionId === "number") {
      void this.cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
    }
    if (typeof frame.data === "string") {
      if (frame.metadata && typeof frame.metadata.deviceWidth === "number") {
        this.lastMeta = {
          deviceWidth: frame.metadata.deviceWidth,
          deviceHeight: frame.metadata.deviceHeight,
          offsetTop: frame.metadata.offsetTop,
          pageScaleFactor: frame.metadata.pageScaleFactor,
          scrollOffsetX: frame.metadata.scrollOffsetX,
          scrollOffsetY: frame.metadata.scrollOffsetY,
        };
      }
      this.frameHandler?.({
        data: frame.data,
        metadata: this.lastMeta,
      });
    }
  }

  async setViewport(width: number, height: number): Promise<void> {
    const w = Math.max(320, Math.min(3840, Math.round(width) || 1280));
    const h = Math.max(240, Math.min(2160, Math.round(height) || 800));
    this.viewport = { width: w, height: h };
    await this.cdp.send("Emulation.setDeviceMetricsOverride", {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 55,
      maxWidth: w,
      maxHeight: h,
      everyNthFrame: 1,
    });
  }

  async navigate(rawUrl: string): Promise<{ href: string }> {
    const parsed = parseBrowseAddress(rawUrl);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    await this.cdp.send("Page.navigate", { url: parsed.href });
    return { href: parsed.href };
  }

  async reload(): Promise<void> {
    await this.cdp.send("Page.reload", { ignoreCache: true });
  }

  async history(delta: -1 | 1): Promise<void> {
    const result = (await this.cdp.send("Page.getNavigationHistory")) as {
      currentIndex?: number;
      entries?: Array<{ id: number }>;
    };
    const index = (result.currentIndex ?? 0) + delta;
    const entry = result.entries?.[index];
    if (!entry) {
      return;
    }
    await this.cdp.send("Page.navigateToHistoryEntry", { entryId: entry.id });
  }

  async mouse(input: {
    type: "mouseMoved" | "mousePressed" | "mouseReleased" | "mouseWheel";
    x: number;
    y: number;
    canvasWidth: number;
    canvasHeight: number;
    deltaX?: number;
    deltaY?: number;
  }): Promise<void> {
    const scaleX = this.lastMeta.deviceWidth / Math.max(1, input.canvasWidth);
    const scaleY = this.lastMeta.deviceHeight / Math.max(1, input.canvasHeight);
    const x = input.x * scaleX;
    const y = input.y * scaleY;
    if (input.type === "mouseWheel") {
      await this.cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x,
        y,
        deltaX: input.deltaX ?? 0,
        deltaY: input.deltaY ?? 0,
      });
      return;
    }
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: input.type,
      x,
      y,
      button: "left",
      clickCount: input.type === "mouseMoved" ? 0 : 1,
    });
  }

  async key(input: { type: "keyDown" | "keyUp" | "char"; key: string; code: string; text?: string }): Promise<void> {
    await this.cdp.send("Input.dispatchKeyEvent", {
      type: input.type === "char" ? "char" : input.type,
      key: input.key,
      code: input.code,
      text: input.text,
      unmodifiedText: input.text,
    });
  }

  get debugHttpPort(): number {
    return this.debugPort;
  }

  async close(): Promise<void> {
    this.cdp.close();
    if (!this.child.killed) {
      this.child.kill("SIGTERM");
      const killer = setTimeout(() => {
        if (!this.child.killed) {
          this.child.kill("SIGKILL");
        }
      }, 2000);
      await new Promise<void>((resolve) => {
        this.child.once("exit", () => {
          clearTimeout(killer);
          resolve();
        });
      });
    }
    await this.cleanupFiles();
  }

  private async cleanupFiles(): Promise<void> {
    await rm(this.userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
