import { createServer, IncomingMessage } from "node:http";
import { appendFile, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { accessSync, constants as fsConstants, createReadStream, readFileSync } from "node:fs";
import { arch, cpus, freemem, homedir, loadavg, networkInterfaces, platform, totalmem, uptime } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import pty from "node-pty";
import { loadConfigFromEnv, WinnowConfig } from "../config/schema.js";
import { getStatusSnapshot } from "./status.js";
import {
  applyProjectProfile,
  loadProjectProfile,
  saveProjectProfile,
} from "../config/projectProfile.js";
import { loadDotenvFromDisk, readDotenvFile, WINNOW_DOTENV_SPECS, writeDotenvFileFull } from "../config/dotenvFile.js";
import { buildAgentWindowPageHtml } from "./agentWindowHtml.js";
import {
  readProjectDocsIndex,
  rebuildAndWriteProjectDocsIndex,
  resolveDocFilePath,
} from "./projectDocsIndex.js";
import { listProjects, registerProject } from "../config/projects.js";
import {
  finalizeRun,
  queryFilters,
  queryLastAgentRun,
  queryRuns,
  querySummary,
  queryTimeseries,
  recordRunUsage,
  upsertRunStart,
  usageDbStatus,
} from "../data/usageStore.js";
import { buildDiskDashboard } from "../data/diskSnapshotService.js";
import {
  ensureCursorWorkspaceLayout,
  ensureCursorWorkspaceLayoutSync,
} from "../cursor/bootstrapCursorWorkspace.js";
import {
  agentTranscriptDirForWorkspaceRoot,
  findCursorTranscriptJsonlPath,
  getTranscriptDir,
  listCursorSessions,
  listCursorSessionsForWorkspaceRoot,
  SessionSummary,
} from "../cursor/sessionUtils.js";

import {
  DEFAULT_PANE_COMMANDS,
  type AgentEvent,
  type AgentSession,
  type AgentStartRequest,
  type FileListEntry,
  type LocalSessionIndexEntry,
  type LocalSessionRecord,
  type PaneId,
  type ProfileUpdateRequest,
  type SessionMessage,
  type SessionStreamClient,
  type StageFilesRequest,
  type UiOptions,
} from "./ui/types.js";
import { sendJson, readJsonBody } from "./ui/httpUtil.js";
import { readCursorSession } from "./ui/cursorSessionRead.js";
import { buildMainTerminalHtml } from "./ui/mainGridHtml.js";
import { buildDashboardPageHtml } from "./ui/dashboardHtml.js";

function applyMode(config: WinnowConfig, mode: "zh" | "raw" | "dual"): WinnowConfig {
  if (mode === "zh") {
    return { ...config, outputMode: "en_to_zh", showOriginal: false, dualOutput: false };
  }
  if (mode === "dual") {
    return { ...config, outputMode: "en_to_zh", showOriginal: true, dualOutput: true };
  }
  return { ...config, inputMode: "off", outputMode: "off", showOriginal: false, dualOutput: false };
}

function maybeOpenBrowser(url: string): void {
  if (process.platform === "darwin") {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
  }
}

export async function runUiServer(baseConfig: WinnowConfig, options: UiOptions): Promise<void> {
  let config = { ...baseConfig };
  const winnowLaunchRoot = resolve(process.cwd());
  const uiWorkspace = { dir: winnowLaunchRoot };

  // Register current directory as a project
  await registerProject(winnowLaunchRoot);

  function expandUserPathSegment(raw: string): string {
    const t = raw.trim();
    if (t === "~") {
      return homedir();
    }
    if (t.startsWith("~/") || t.startsWith("~\\")) {
      return join(homedir(), t.slice(2));
    }
    return t;
  }

  function resolveUiPath(inputPath?: string): string {
    if (!inputPath?.trim()) {
      return uiWorkspace.dir;
    }
    const expanded = expandUserPathSegment(inputPath.trim());
    if (expanded.startsWith("/") || /^[A-Za-z]:[\\/]/.test(expanded)) {
      return resolve(expanded);
    }
    return resolve(uiWorkspace.dir, expanded);
  }

  async function applyWorkspaceDir(nextAbsolute: string, persist: boolean): Promise<string> {
    const resolved = resolve(nextAbsolute);
    const real = await realpath(resolved).catch(() => resolved);
    const info = await stat(real);
    if (!info.isDirectory()) {
      throw new Error(`Not a directory: ${real}`);
    }
    uiWorkspace.dir = real;
    await ensureCursorWorkspaceLayout(uiWorkspace.dir);
    if (persist) {
      config = { ...config, uiWorkspaceDir: real };
      await saveProjectProfile(config);
    }
    return real;
  }

  if (config.uiWorkspaceDir?.trim()) {
    try {
      await applyWorkspaceDir(expandUserPathSegment(config.uiWorkspaceDir), false);
    } catch {
      uiWorkspace.dir = winnowLaunchRoot;
    }
  }
  await ensureCursorWorkspaceLayout(uiWorkspace.dir);

  const cursorTranscriptDirForUi = (): string =>
    process.env.WINNOW_AGENT_TRANSCRIPTS_DIR?.trim()
      ? getTranscriptDir()
      : agentTranscriptDirForWorkspaceRoot(uiWorkspace.dir);

  async function readRecentLogEntries(logsDir: string, limit = 50): Promise<string[]> {
    try {
      const filePath = join(uiWorkspace.dir, logsDir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
      const content = await readFile(filePath, "utf8");
      const lines = content.trim().split("\n").filter(Boolean);
      return lines.slice(Math.max(0, lines.length - limit));
    } catch {
      return [];
    }
  }

  function runGitCommand(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return new Promise((resolvePromise) => {
      const child = spawn("git", args, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: uiWorkspace.dir,
        env: process.env,
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (buf: Buffer) => {
        stdout += buf.toString("utf8");
      });
      child.stderr?.on("data", (buf: Buffer) => {
        stderr += buf.toString("utf8");
      });
      child.on("error", (error) => {
        resolvePromise({ ok: false, stdout: "", stderr: error.message });
      });
      child.on("close", (code: number | null) => {
        resolvePromise({ ok: code === 0, stdout, stderr });
      });
    });
  }

  async function getWorkspaceChanges() {
    const status = await runGitCommand(["status", "--short"]);
    const diff = await runGitCommand(["diff"]);
    const files = status.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const candidate = line.slice(3).trim();
        const renameSplit = candidate.split(" -> ");
        return renameSplit[renameSplit.length - 1];
      });

    return {
      ok: status.ok && diff.ok,
      files,
      diff: diff.stdout,
      status: status.stdout,
      error: [status.stderr, diff.stderr].filter(Boolean).join("\n"),
    };
  }

  async function listDirectory(dirPath?: string): Promise<{
    cwd: string;
    parent: string | null;
    entries: FileListEntry[];
  }> {
    const absolute = resolveUiPath(dirPath);
    const info = await stat(absolute);
    if (!info.isDirectory()) {
      throw new Error(`Not a directory: ${absolute}`);
    }
    const dirents = await readdir(absolute, { withFileTypes: true });
    const entries: FileListEntry[] = dirents
      .filter((entry) => !entry.name.startsWith(".git"))
      .map((entry) => ({
        name: entry.name,
        path: join(absolute, entry.name),
        type: (entry.isDirectory() ? "dir" : "file") as "dir" | "file",
      }))
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "dir" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

    const parentPath = resolve(absolute, "..");
    const parent = parentPath === absolute ? null : parentPath;
    return { cwd: absolute, parent, entries };
  }

  async function previewPath(pathValue?: string): Promise<{ path: string; content: string }> {
    const absolute = resolveUiPath(pathValue);
    const info = await stat(absolute);
    if (info.isDirectory()) {
      return { path: absolute, content: "[directory]" };
    }
    if (info.size > 200000) {
      return { path: absolute, content: "[file too large to preview]" };
    }
    const content = await readFile(absolute, "utf8");
    return { path: absolute, content };
  }

  function localSessionDir(): string {
    return join(uiWorkspace.dir, ".winnow", "sessions");
  }

  function localSessionIndexPath(): string {
    return join(localSessionDir(), "index.json");
  }

  function localSessionRecordPath(id: string): string {
    return join(localSessionDir(), `${id}.json`);
  }

  async function readLocalSessionIndex(): Promise<LocalSessionIndexEntry[]> {
    try {
      const content = await readFile(localSessionIndexPath(), "utf8");
      const parsed = JSON.parse(content) as LocalSessionIndexEntry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function writeLocalSessionIndex(entries: LocalSessionIndexEntry[]): Promise<void> {
    await mkdir(localSessionDir(), { recursive: true });
    await writeFile(localSessionIndexPath(), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  }

  async function countSessionRecordJsonFiles(): Promise<number> {
    try {
      const names = await readdir(localSessionDir());
      return names.filter((n) => n.endsWith(".json") && n !== "index.json").length;
    } catch {
      return 0;
    }
  }

  /** Rebuild index rows for any `*.json` session record on disk that is missing from the index. */
  async function mergeSessionRecordsMissingFromIndex(index: LocalSessionIndexEntry[]): Promise<LocalSessionIndexEntry[]> {
    const byId = new Map(index.map((e) => [e.id, e]));
    let dir: string;
    try {
      dir = localSessionDir();
      const names = await readdir(dir);
      for (const name of names) {
        if (!name.endsWith(".json") || name === "index.json") {
          continue;
        }
        const id = name.slice(0, -".json".length);
        if (byId.has(id)) {
          continue;
        }
        try {
          const raw = await readFile(join(dir, name), "utf8");
          const record = JSON.parse(raw) as LocalSessionRecord;
          if (record.id !== id) {
            continue;
          }
          const entry: LocalSessionIndexEntry = {
            id,
            startedAt: record.startedAt,
            updatedAt: record.endedAt || record.startedAt,
            status: record.status,
            preview: (record.prompt || record.output || "").slice(0, 160),
            source: "winnow-local",
          };
          byId.set(id, entry);
        } catch {
          // skip corrupt or partial record
        }
      }
    } catch {
      return index;
    }
    return [...byId.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  /**
   * Serialize writes to `sessions/index.json`. Concurrent upserts each read+merge+write; without
   * ordering, two writers can both read the old index and the last write drops the other session.
   */
  let localSessionIndexWriteChain: Promise<void> = Promise.resolve();

  async function upsertLocalSessionIndex(entry: LocalSessionIndexEntry): Promise<void> {
    const run = async (): Promise<void> => {
      let current = await readLocalSessionIndex();
      if (current.length < (await countSessionRecordJsonFiles())) {
        current = await mergeSessionRecordsMissingFromIndex(current);
      }
      const next = [entry, ...current.filter((item) => item.id !== entry.id)]
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, 500);
      await writeLocalSessionIndex(next);
    };
    const job = localSessionIndexWriteChain.then(run, run);
    localSessionIndexWriteChain = job.catch(() => {
      /* keep queue alive; void callers must not strand later upserts */
    });
    await job.catch((err) => {
      process.stderr.write(`[winnow-ui] session index update failed: ${(err as Error).message}\n`);
    });
  }

  async function writeLocalSessionRecord(record: LocalSessionRecord): Promise<void> {
    await mkdir(localSessionDir(), { recursive: true });
    await writeFile(localSessionRecordPath(record.id), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  async function repairLocalSessionIndexIfStale(): Promise<void> {
    const run = async (): Promise<void> => {
      let current = await readLocalSessionIndex();
      if (current.length >= (await countSessionRecordJsonFiles())) {
        return;
      }
      current = await mergeSessionRecordsMissingFromIndex(current);
      await writeLocalSessionIndex(current.slice(0, 500));
    };
    const job = localSessionIndexWriteChain.then(run, run);
    localSessionIndexWriteChain = job.catch(() => {});
    await job.catch((err) => {
      process.stderr.write(`[winnow-ui] session index repair failed: ${(err as Error).message}\n`);
    });
  }

  async function listLocalSessions(limit = 20): Promise<SessionSummary[]> {
    await repairLocalSessionIndexIfStale();
    const index = await readLocalSessionIndex();
    return index.slice(0, Math.max(1, limit)).map((entry) => ({
      id: entry.id,
      file: localSessionRecordPath(entry.id),
      updatedAt: entry.updatedAt,
      preview: entry.preview,
    }));
  }

  async function readLocalSession(id: string): Promise<{ id: string; messages: SessionMessage[] }> {
    const content = await readFile(localSessionRecordPath(id), "utf8");
    const record = JSON.parse(content) as LocalSessionRecord;
    if (Array.isArray(record.events) && record.events.length > 0) {
      const messages = record.events.map((event) => ({
        id: event.id,
        role: event.kind,
        content: event.content,
        timestamp: event.ts,
      }));
      return { id, messages };
    }
    const messages: SessionMessage[] = [
      { id: "init-prompt", role: "user", content: record.prompt, timestamp: record.startedAt },
    ];
    if (record.output?.trim()) {
      messages.push({ id: "init-output", role: "assistant", content: record.output, timestamp: record.endedAt });
    }
    if (record.errorOutput?.trim()) {
      messages.push({ id: "init-error", role: "stderr", content: record.errorOutput, timestamp: record.endedAt });
    }
    return { id, messages };
  }

  const sessions = new Map<string, AgentSession>();
  const streamClients = new Map<string, Set<SessionStreamClient>>();
  /** Live cursor-agent child processes keyed by session id (for cancel / stop). */
  const agentRunChildProcesses = new Map<string, ChildProcess>();
  const nodeMajor = Number(process.versions.node.split(".")[0] || "0");
  const supportsPty = nodeMajor >= 20 && nodeMajor < 23;

  const requireToken = Boolean(options.token);
  const isAuthorized = (url: URL): boolean => {
    if (!requireToken) {
      return true;
    }
    return url.searchParams.get("token") === options.token;
  };

  const paneCommands: Record<PaneId, string> = {
    ...DEFAULT_PANE_COMMANDS,
    ...(options.paneCommands ?? {}),
  };
  const mainPaneSessions = new Map<PaneId, { ws: WebSocket; ptyProcess: pty.IPty }>();
  const mainPaneWs = new WebSocketServer({ noServer: true });

  const closeMainPane = (paneId: PaneId): void => {
    const existing = mainPaneSessions.get(paneId);
    if (!existing) {
      return;
    }
    try {
      existing.ptyProcess.kill();
    } catch {
      // ignore
    }
    mainPaneSessions.delete(paneId);
  };

  const spawnMainPane = (paneId: PaneId): pty.IPty => {
    const shellCandidates = [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].filter(
      (value): value is string => Boolean(value && value.trim()),
    );
    const shell = shellCandidates.find((candidate) => {
      try {
        accessSync(candidate, fsConstants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
    if (!shell) {
      throw new Error("no executable shell found for PTY");
    }
    const rawCommand = (paneCommands[paneId] || "").trim();
    const launchScript = rawCommand ? `${rawCommand}; exec ${shell}` : `exec ${shell}`;
    try {
      return pty.spawn(shell, ["-lc", launchScript], {
        name: "xterm-256color",
        cols: 120,
        rows: 36,
        cwd: uiWorkspace.dir,
        env: process.env as Record<string, string>,
      });
    } catch {
      for (const candidate of shellCandidates) {
        try {
          return pty.spawn(candidate, [], {
            name: "xterm-256color",
            cols: 120,
            rows: 36,
            cwd: uiWorkspace.dir,
            env: process.env as Record<string, string>,
          });
        } catch {
          // keep trying candidates
        }
      }
      throw new Error(`unable to spawn shell for pane ${paneId}`);
    }
  };

  mainPaneWs.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    if (!supportsPty) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          `\r\n[main-grid disabled: Node ${process.versions.node} is unsupported for PTY]\r\n` +
            `[use Node 22 LTS and rerun: npm run setup]\r\n`,
        );
      }
      ws.close(1011, "unsupported node version for pty");
      return;
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`);
    const paneId = url.pathname.split("/").pop() as PaneId;
    if (!paneId || !["1", "2", "3", "4", "5"].includes(paneId)) {
      ws.close(1008, "invalid pane id");
      return;
    }

    closeMainPane(paneId);
    let ptyProcess: pty.IPty;
    try {
      ptyProcess = spawnMainPane(paneId);
    } catch (error) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n[failed to start pane ${paneId}: ${(error as Error).message}]\r\n`);
      }
      ws.close(1011, "pty spawn failed");
      return;
    }
    mainPaneSessions.set(paneId, { ws, ptyProcess });

    ptyProcess.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
    ptyProcess.onExit(({ exitCode }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\n[process exited: ${exitCode}]\r\n`);
      }
      closeMainPane(paneId);
    });

    ws.on("message", (payload: Buffer) => {
      try {
        const message = JSON.parse(payload.toString("utf8")) as {
          type: "input" | "resize";
          data?: string;
          cols?: number;
          rows?: number;
        };
        const live = mainPaneSessions.get(paneId);
        if (!live) {
          return;
        }
        if (message.type === "input" && typeof message.data === "string") {
          live.ptyProcess.write(message.data);
        } else if (message.type === "resize" && Number.isFinite(message.cols) && Number.isFinite(message.rows)) {
          live.ptyProcess.resize(Math.max(20, Number(message.cols)), Math.max(6, Number(message.rows)));
        }
      } catch {
        // ignore malformed client message
      }
    });
    ws.on("close", () => {
      closeMainPane(paneId);
    });
  });

  const pushStreamEvent = (
    sessionId: string,
    event: "stdout" | "stderr" | "status" | "done" | "timeline",
    payload: unknown,
  ) => {
    const clients = streamClients.get(sessionId);
    if (!clients || clients.size === 0) {
      return;
    }
    const body = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) {
      client.res.write(body);
    }
  };

  const closeStreamClients = (sessionId: string) => {
    const clients = streamClients.get(sessionId);
    if (!clients) {
      return;
    }
    for (const client of clients) {
      client.res.end();
    }
    streamClients.delete(sessionId);
  };

  const forceCursorNativeConfig = (input: WinnowConfig): WinnowConfig => ({
    ...input,
    inputMode: "off",
    outputMode: "off",
    showOriginal: false,
    dualOutput: false,
  });

  const parseArgs = (raw: string): string[] => raw.split(/\s+/).map((x) => x.trim()).filter(Boolean);
  const ensureModelArg = (args: string[], preference: "default" | "auto" | "composer"): string[] => {
    if (preference === "default") {
      return args;
    }
    if (args.includes("--model")) {
      return args;
    }
    const value = preference === "composer" ? "composer" : "auto";
    return [...args, "--model", value];
  };
  const ensureExecutionArgs = (args: string[], autonomyEnabled: boolean, sessionId?: string): string[] => {
    const next = [...args];
    if (sessionId) {
      if (!next.includes("--resume")) {
        next.push("--resume", sessionId);
      }
      if (!next.includes("--print")) {
        next.push("--print");
      }
    } else {
      if (!next.includes("--print")) {
        next.push("--print");
      }
    }
    if (!next.includes("--output-format")) {
      next.push("--output-format", "stream-json");
    }
    if (!next.includes("--stream-partial-output")) {
      next.push("--stream-partial-output");
    }
    if (!autonomyEnabled) {
      return next;
    }
    const hasForce = next.includes("-f") || next.includes("--force") || next.includes("--yolo");
    if (!hasForce) {
      next.push("--force");
    }
    const hasSandboxOverride = next.includes("--sandbox");
    if (!hasSandboxOverride) {
      next.push("--sandbox", "disabled");
    }
    return next;
  };

  const startAgentSession = async (
    payload: AgentStartRequest,
    opts?: { signal?: AbortSignal },
  ): Promise<AgentSession> => {
    const signal = opts?.signal;
    const nativeConfig = forceCursorNativeConfig(config);
    const cursorExe = (nativeConfig.cursorCommand || "").trim() || "cursor-agent";
    const id = (payload.sessionId || "").trim() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseArgs = parseArgs(payload.args ?? "");
    const autonomyEnabled = payload.autonomyMode !== false;
    const args = ensureExecutionArgs(
      ensureModelArg(baseArgs, payload.modelPreference ?? "default"),
      autonomyEnabled,
      id
    );
    const existing = sessions.get(id);
    let session: AgentSession;

    if (existing) {
      session = {
        ...existing,
        status: "running",
        endedAt: undefined,
        error: undefined,
        command: cursorExe,
        args,
        startedAt: existing.startedAt || new Date().toISOString(),
        events: existing.events ?? [],
      };
    } else {
      // Try loading from disk
      let diskEvents: AgentEvent[] = [];
      let diskOutput = "";
      let diskErrorOutput = "";
      let diskStartedAt = new Date().toISOString();

      try {
        const recordPath = localSessionRecordPath(id);
        const content = readFileSync(recordPath, "utf8");
        const record = JSON.parse(content) as LocalSessionRecord;
        diskEvents = record.events || [];
        diskOutput = record.output || "";
        diskErrorOutput = record.errorOutput || "";
        diskStartedAt = record.startedAt || diskStartedAt;
      } catch {
        // New session or failed to read
      }

      session = {
        id,
        status: "running",
        startedAt: diskStartedAt,
        output: diskOutput,
        errorOutput: diskErrorOutput,
        command: cursorExe,
        args,
        events: diskEvents,
      };
    }

    sessions.set(id, session);
    const startedAt = session.startedAt;
    const modelPreference = payload.modelPreference ?? "default";
    const prompt = payload.prompt;

    const persistRecord = () =>
      writeLocalSessionRecord({
        id,
        projectRoot: uiWorkspace.dir,
        startedAt,
        endedAt: session.endedAt,
        status: session.status,
        args,
        modelPreference,
        prompt,
        output: session.output,
        errorOutput: session.errorOutput,
        events: session.events,
      });

    const pushEvent = (kind: AgentEvent["kind"], content: string) => {
      const event: AgentEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toISOString(),
        kind,
        content,
      };
      session.events.push(event);
      if (session.events.length > 2000) {
        session.events = session.events.slice(-2000);
      }
      pushStreamEvent(id, "timeline", { sessionId: id, event });
    };

    const abortOrThrow = (): void => {
      if (!signal?.aborted) {
        return;
      }
      session.status = "error";
      session.error = "Start cancelled";
      session.endedAt = new Date().toISOString();
      pushEvent("status", "Start cancelled.");
      void persistRecord();
      finalizeRun(id, "error", null, session.endedAt);
      void upsertLocalSessionIndex({
        id,
        startedAt,
        updatedAt: session.endedAt,
        status: "error",
        preview: prompt.slice(0, 160),
        source: "winnow-local",
      });
      closeStreamClients(id);
      sessions.delete(id);
      throw new DOMException("Start cancelled", "AbortError");
    };

    pushEvent("user", prompt);

    ensureCursorWorkspaceLayoutSync(uiWorkspace.dir);
    void persistRecord();
    void upsertLocalSessionIndex({
      id,
      startedAt,
      updatedAt: startedAt,
      status: session.status,
      preview: prompt.slice(0, 160),
      source: "winnow-local",
    });

    upsertRunStart({
      id,
      projectPath: uiWorkspace.dir,
      projectName: basename(uiWorkspace.dir),
      source: "cursor-agent",
      modelPref: modelPreference,
      startedAt,
      status: "running",
      promptPreview: prompt,
    });

    abortOrThrow();

    const child = spawn(cursorExe, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: uiWorkspace.dir,
      env: process.env,
    });
    agentRunChildProcesses.set(id, child);

    child.on("error", (error) => {
      agentRunChildProcesses.delete(id);
      session.status = "error";
      session.error = error.message;
      session.endedAt = new Date().toISOString();
      pushEvent("status", `spawn error: ${error.message}`);
      void persistRecord();
      finalizeRun(id, "error", 1, session.endedAt);
    });

    let stdoutBuffer = "";
    child.stdout?.on("data", (buf: Buffer) => {
      stdoutBuffer += buf.toString("utf8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.type === "assistant" && data.message?.content) {
            // Only process partial stream chunks to avoid double-printing full collapsed blocks
            if (!data.model_call_id) {
              const text = data.message.content.map((c: any) => c.text).join("");
              session.output += text;
              pushEvent("assistant", text);
            }
          } else if (data.type === "tool_call") {
            const toolType = Object.keys(data.tool_call || {})[0] || "tool";
            const toolData = (data.tool_call || {})[toolType] || {};

            let action = toolType.replace("ToolCall", "");
            let target = "";

            if (toolData.args?.path) {
              target = toolData.args.path.split("/").pop() || toolData.args.path;
            } else if (toolData.args?.command) {
              target = toolData.args.command;
            } else if (toolData.args?.pattern) {
              target = toolData.args.pattern;
            } else if (toolData.args?.query) {
              target = toolData.args.query;
            }

            const prefix = data.subtype === "started" ? "▶" : "✓";
            pushEvent("tool", `${prefix} ${action} ${target}`.trim());

            if (data.subtype === "completed") {
              session.output += "\n";
            }
          } else if (data.type === "result") {
            if (data.subtype === "success") {
              if (data.usage) {
                recordRunUsage(id, {
                  inputTokens: Number(data.usage.inputTokens) || 0,
                  outputTokens: Number(data.usage.outputTokens) || 0,
                  model: typeof data.model === "string" ? data.model : undefined,
                });
              }
              const usage = data.usage ? ` (Tokens: ${data.usage.inputTokens} IN / ${data.usage.outputTokens} OUT)` : "";
              pushEvent("status", `✓ Run completed${usage}`);
            } else {
              pushEvent("status", `Result: ${data.subtype}`);
            }
          }
        } catch {
          session.output += `${line}\n`;
          pushEvent("assistant", `${line}\n`);
        }
      }
      void persistRecord();
    });
    child.stderr?.on("data", (buf: Buffer) => {
      const chunk = buf.toString("utf8");
      session.errorOutput += chunk;
      pushEvent("stderr", chunk);
      void persistRecord();
    });

    child.stdin?.write(`${prompt}\n`);
    child.stdin?.end();

    child.on("close", (code: number | null) => {
      agentRunChildProcesses.delete(id);
      void (async () => {
        session.exitCode = code ?? 1;
        session.status = session.exitCode === 0 ? "done" : "error";
        session.endedAt = new Date().toISOString();
        const msg =
          session.exitCode === 0
            ? "✨ Session closed successfully."
            : `❌ Session ended with error (exit code: ${session.exitCode})`;
        pushEvent("status", msg);
        void persistRecord();
        finalizeRun(id, session.status, session.exitCode ?? null, session.endedAt);
        void upsertLocalSessionIndex({
          id,
          startedAt,
          updatedAt: session.endedAt,
          status: session.status,
          preview: (session.output || prompt).slice(0, 160),
          source: "winnow-local",
        });
        pushStreamEvent(id, "status", {
          status: session.status,
          exitCode: session.exitCode,
          endedAt: session.endedAt,
        });
        pushStreamEvent(id, "done", { sessionId: id });
        closeStreamClients(id);
      })();
    });

    return session;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`);
    if (!isAuthorized(url)) {
      sendJson(res, 401, { ok: false, error: "unauthorized: invalid or missing token" });
      return;
    }

    if (url.pathname === "/api/workspace/cwd" && req.method === "GET") {
      sendJson(res, 200, {
        cwd: uiWorkspace.dir,
        launchRoot: winnowLaunchRoot,
        transcriptDir: cursorTranscriptDirForUi(),
      });
      return;
    }

    if (url.pathname === "/api/system" && req.method === "GET") {
      sendJson(res, 200, {
        platform: platform(),
        arch: arch(),
        cpus: cpus().length,
        cpuModel: cpus()[0]?.model,
        totalMem: totalmem(),
        freeMem: freemem(),
        uptime: uptime(),
        loadAvg: loadavg(),
        nodeVersion: process.version,
      });
      return;
    }

    if (url.pathname === "/api/dashboard/last-agent-run" && req.method === "GET") {
      const r = queryLastAgentRun();
      if (!r.ok) {
        sendJson(res, 200, {
          ok: false,
          reason: r.reason,
          run: null,
          transcriptBase: cursorTranscriptDirForUi(),
        });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        run: r.run,
        transcriptBase: cursorTranscriptDirForUi(),
      });
      return;
    }

    if (url.pathname === "/api/dashboard/disk" && req.method === "GET") {
      try {
        const body = await buildDiskDashboard({
          volumePath: uiWorkspace.dir,
        });
        sendJson(res, 200, { ...body, workspaceRoot: uiWorkspace.dir });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/projects" && req.method === "GET") {
      const projects = await listProjects();
      sendJson(res, 200, { projects });
      return;
    }

    if (url.pathname === "/api/usage/status" && req.method === "GET") {
      sendJson(res, 200, usageDbStatus());
      return;
    }

    if (url.pathname === "/api/usage/summary" && req.method === "GET") {
      const rawRange = url.searchParams.get("range") ?? "all";
      const range = (["today", "7d", "30d", "all"].includes(rawRange) ? rawRange : "all") as "today" | "7d" | "30d" | "all";
      sendJson(res, 200, querySummary(range));
      return;
    }

    if (url.pathname === "/api/usage/timeseries" && req.method === "GET") {
      const rawRange = url.searchParams.get("range") ?? "7d";
      const allowedRanges = ["24h", "7d", "30d", "90d", "all"] as const;
      const range = allowedRanges.includes(rawRange as (typeof allowedRanges)[number])
        ? (rawRange as (typeof allowedRanges)[number])
        : "7d";
      const rawBucket = url.searchParams.get("bucket") ?? "day";
      const allowedBuckets = ["hour", "day", "week"] as const;
      const bucket = allowedBuckets.includes(rawBucket as (typeof allowedBuckets)[number])
        ? (rawBucket as (typeof allowedBuckets)[number])
        : "day";
      const body = queryTimeseries({
        range,
        bucket,
        projectPath: url.searchParams.get("projectPath") ?? undefined,
        model: url.searchParams.get("model") ?? undefined,
        source: url.searchParams.get("source") ?? undefined,
      });
      sendJson(res, 200, body);
      return;
    }

    if (url.pathname === "/api/usage/runs" && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const body = queryRuns({
        limit: Number.isFinite(limit) ? limit : 50,
        projectPath: url.searchParams.get("projectPath") ?? undefined,
        model: url.searchParams.get("model") ?? undefined,
        source: url.searchParams.get("source") ?? undefined,
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
      });
      sendJson(res, 200, body);
      return;
    }

    if (url.pathname === "/api/usage/filters" && req.method === "GET") {
      sendJson(res, 200, queryFilters());
      return;
    }

    if (url.pathname === "/api/workspace/cwd" && req.method === "POST") {
      try {
        const payload = (await readJsonBody(req)) as { path?: string; reset?: boolean };
        if (payload.reset) {
          const next = await applyWorkspaceDir(winnowLaunchRoot, true);
          await registerProject(next);
          void rebuildAndWriteProjectDocsIndex(next).catch(() => {});
          sendJson(res, 200, {
            ok: true,
            cwd: next,
            transcriptDir: cursorTranscriptDirForUi(),
            launchRoot: winnowLaunchRoot,
          });
          return;
        }
        const raw = payload.path?.trim();
        if (!raw) {
          sendJson(res, 400, { ok: false, error: "path is required unless reset is true" });
          return;
        }
        const candidate = resolveUiPath(raw);
        const next = await applyWorkspaceDir(candidate, true);
        await registerProject(next);
        void rebuildAndWriteProjectDocsIndex(next).catch(() => {});
        sendJson(res, 200, {
          ok: true,
          cwd: next,
          transcriptDir: cursorTranscriptDirForUi(),
          launchRoot: winnowLaunchRoot,
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/state" && req.method === "GET") {
      const state = await getStatusSnapshot(config);
      sendJson(res, 200, state);
      return;
    }

    if (url.pathname === "/api/logs" && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const logs = await readRecentLogEntries(config.logsDir, Number.isFinite(limit) ? limit : 50);
      sendJson(res, 200, { logs });
      return;
    }

    if (url.pathname === "/api/workspace" && req.method === "GET") {
      const workspace = await getWorkspaceChanges();
      sendJson(res, 200, workspace);
      return;
    }

    if (url.pathname === "/api/workspace/stage" && req.method === "POST") {
      try {
        const payload = (await readJsonBody(req)) as StageFilesRequest;
        const files = Array.isArray(payload.files) ? payload.files.filter(Boolean) : [];
        if (files.length === 0) {
          sendJson(res, 400, { ok: false, error: "files array is required" });
          return;
        }
        const result = await runGitCommand(["add", "--", ...files]);
        sendJson(res, result.ok ? 200 : 400, {
          ok: result.ok,
          stderr: result.stderr,
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/workspace/docs-index" && req.method === "GET") {
      try {
        const refresh = url.searchParams.get("refresh") === "1";
        let index = await readProjectDocsIndex(uiWorkspace.dir);
        if (refresh || !index) {
          index = await rebuildAndWriteProjectDocsIndex(uiWorkspace.dir);
        }
        sendJson(res, 200, { ok: true, index });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/workspace/doc" && req.method === "GET") {
      try {
        const rel = url.searchParams.get("path") ?? "";
        const abs = resolveDocFilePath(uiWorkspace.dir, rel);
        const info = await stat(abs);
        if (!info.isFile()) {
          sendJson(res, 400, { ok: false, error: "not a file" });
          return;
        }
        const lower = abs.toLowerCase();
        if (lower.endsWith(".md")) {
          const markdown = await readFile(abs, "utf8");
          sendJson(res, 200, { ok: true, kind: "md" as const, relPath: rel, markdown });
          return;
        }
        if (lower.endsWith(".pdf")) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Length", String(info.size));
          createReadStream(abs).pipe(res);
          return;
        }
        sendJson(res, 400, { ok: false, error: "unsupported file type" });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/fs/list" && req.method === "GET") {
      try {
        const target = url.searchParams.get("path") ?? undefined;
        const result = await listDirectory(target);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/fs/preview" && req.method === "GET") {
      try {
        const target = url.searchParams.get("path") ?? undefined;
        if (!target) {
          sendJson(res, 400, { ok: false, error: "path query is required" });
          return;
        }
        const result = await previewPath(target);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/env" && req.method === "GET") {
      try {
        const fileRecord = readDotenvFile(winnowLaunchRoot);
        const entries = WINNOW_DOTENV_SPECS.map((spec) => {
          const fromProc = process.env[spec.key];
          const fromFile = fileRecord[spec.key];
          const effective = String(fromProc ?? fromFile ?? "");
          const hasValue = effective.trim().length > 0;
          return {
            key: spec.key,
            description: spec.description,
            sensitive: Boolean(spec.sensitive),
            value: spec.sensitive ? "" : effective,
            hasValue,
          };
        });
        sendJson(res, 200, { ok: true, entries });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/env" && req.method === "POST") {
      try {
        const body = (await readJsonBody(req)) as { values?: Record<string, string> };
        const incoming = body.values ?? {};
        const prev = readDotenvFile(winnowLaunchRoot);
        const merged: Record<string, string> = { ...prev };
        for (const spec of WINNOW_DOTENV_SPECS) {
          if (!(spec.key in incoming)) {
            continue;
          }
          const v = incoming[spec.key];
          if (v === undefined) {
            continue;
          }
          if (spec.sensitive && String(v).trim() === "") {
            continue;
          }
          merged[spec.key] = String(v);
        }
        writeDotenvFileFull(winnowLaunchRoot, merged);
        loadDotenvFromDisk(winnowLaunchRoot, { override: true });
        const fromEnv = loadConfigFromEnv();
        const profile = await loadProjectProfile();
        config = applyProjectProfile(fromEnv, profile);
        sendJson(res, 200, { ok: true, message: "Saved .env and reloaded configuration in this process." });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/profile" && req.method === "POST") {
      try {
        const payload = (await readJsonBody(req)) as ProfileUpdateRequest;
        if (payload.backend) {
          config = { ...config, translatorBackend: payload.backend };
        }
        if (payload.model) {
          config = {
            ...config,
            ollamaTranslationModel: payload.model,
            deepseekModel: payload.model,
          };
        }
        if (payload.glossary !== undefined) {
          config = { ...config, translationGlossary: payload.glossary };
        }
        if (payload.mode) {
          config = applyMode(config, payload.mode);
        }
        await saveProjectProfile(config);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/sessions" && req.method === "GET") {
      try {
        const limit = Number(url.searchParams.get("limit") ?? "20");
        const explicitDir = url.searchParams.get("dir") ?? undefined;
        const max = Number.isFinite(limit) ? limit : 20;
        const local = await listLocalSessions(max);
        const envTranscripts = Boolean(process.env.WINNOW_AGENT_TRANSCRIPTS_DIR?.trim());
        let cursor: SessionSummary[];
        let transcriptDirLabel: string;
        if (explicitDir) {
          transcriptDirLabel = getTranscriptDir(explicitDir);
          cursor = await listCursorSessions(max, transcriptDirLabel).catch(() => []);
        } else if (envTranscripts) {
          transcriptDirLabel = getTranscriptDir();
          cursor = await listCursorSessions(max, transcriptDirLabel).catch(() => []);
        } else {
          transcriptDirLabel = agentTranscriptDirForWorkspaceRoot(uiWorkspace.dir);
          cursor = await listCursorSessionsForWorkspaceRoot(uiWorkspace.dir, max).catch(() => []);
        }
        const mergedRaw = [...local, ...cursor].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        const byId = new Map<string, SessionSummary>();
        for (const s of mergedRaw) {
          const prev = byId.get(s.id);
          if (!prev || prev.updatedAt < s.updatedAt) {
            byId.set(s.id, s);
          }
        }
        const merged = [...byId.values()]
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
          .slice(0, max);
        sendJson(res, 200, {
          sessions: merged,
          dir: transcriptDirLabel,
          localDir: localSessionDir(),
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname.startsWith("/api/sessions/") && req.method === "GET") {
      try {
        const id = url.pathname.replace("/api/sessions/", "").trim();
        const explicitDir = url.searchParams.get("dir") ?? undefined;
        const envTranscripts = Boolean(process.env.WINNOW_AGENT_TRANSCRIPTS_DIR?.trim());
        let session: { id: string; messages: SessionMessage[] };
        try {
          session = await readLocalSession(id);
        } catch {
          if (explicitDir) {
            session = await readCursorSession(id, explicitDir);
          } else if (envTranscripts) {
            session = await readCursorSession(id);
          } else {
            session = await readCursorSession(id, undefined, uiWorkspace.dir);
          }
        }
        sendJson(res, 200, session);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/translate/deepseek-smoke" && req.method === "GET") {
      try {
        const { smokeTestDeepseekChat } = await import("../translator/deepseekChat.js");
        const r = await smokeTestDeepseekChat(config);
        sendJson(res, 200, {
          ok: r.ok,
          attemptedUrls: r.attemptedUrls,
          lastUrl: r.lastUrl,
          lastStatus: r.lastStatus,
          lastBodySnippet: r.lastBodySnippet,
          error: r.error,
        });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/agent/start" && req.method === "POST") {
      const abortFromDisconnect = new AbortController();
      // Do not use req "close" — it fires when the *incoming* request stream ends (e.g. after the
      // POST body is read), which aborts immediately. Use response "close" only before any reply
      // is sent, i.e. the client actually disconnected while waiting.
      const onClientGone = (): void => {
        if (!res.headersSent) {
          abortFromDisconnect.abort();
        }
      };
      res.on("close", onClientGone);
      try {
        const payload = (await readJsonBody(req)) as AgentStartRequest;
        if (!payload.prompt?.trim()) {
          sendJson(res, 400, { ok: false, error: "prompt is required" });
          return;
        }
        const session = await startAgentSession(payload, { signal: abortFromDisconnect.signal });
        sendJson(res, 200, { ok: true, sessionId: session.id });
      } catch (error) {
        const aborted =
          error instanceof DOMException && error.name === "AbortError"
            ? true
            : (error as Error)?.name === "AbortError";
        if (aborted) {
          if (!res.headersSent) {
            sendJson(res, 499, { ok: false, error: "cancelled" });
          }
          return;
        }
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      } finally {
        res.removeListener("close", onClientGone);
      }
      return;
    }

    if (url.pathname.startsWith("/api/agent/") && url.pathname.endsWith("/stop") && req.method === "POST") {
      const id = url.pathname.slice("/api/agent/".length, -"/stop".length);
      const session = sessions.get(id);
      if (!session) {
        sendJson(res, 404, { ok: false, error: "session not found" });
        return;
      }
      if (session.status !== "running") {
        sendJson(res, 200, { ok: true, stopped: false, message: "session not running" });
        return;
      }
      const child = agentRunChildProcesses.get(id);
      if (!child || child.killed) {
        sendJson(res, 200, { ok: true, stopped: false, message: "no active process handle" });
        return;
      }
      try {
        child.kill("SIGTERM");
        sendJson(res, 200, { ok: true, stopped: true });
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (url.pathname.startsWith("/api/agent/") && req.method === "GET") {
      if (url.pathname.endsWith("/stream")) {
        const id = url.pathname.replace("/api/agent/", "").replace("/stream", "").trim();
        const session = sessions.get(id);
        if (!session) {
          sendJson(res, 404, { ok: false, error: "session not found" });
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();

        const client: SessionStreamClient = { res };
        const current = streamClients.get(id) ?? new Set<SessionStreamClient>();
        current.add(client);
        streamClients.set(id, current);

        res.write(`event: status\ndata: ${JSON.stringify({ status: session.status, sessionId: id })}\n\n`);
        if (session.events?.length) {
          for (const event of session.events.slice(-500)) {
            res.write(`event: timeline\ndata: ${JSON.stringify({ sessionId: id, event })}\n\n`);
          }
        } else {
          if (session.output) {
            res.write(`event: stdout\ndata: ${JSON.stringify({ chunk: session.output, sessionId: id })}\n\n`);
          }
          if (session.errorOutput) {
            res.write(`event: stderr\ndata: ${JSON.stringify({ chunk: session.errorOutput, sessionId: id })}\n\n`);
          }
        }
        if (session.status !== "running") {
          res.write(`event: done\ndata: ${JSON.stringify({ sessionId: id })}\n\n`);
          res.end();
          current.delete(client);
          if (current.size === 0) {
            streamClients.delete(id);
          }
          return;
        }

        req.on("close", () => {
          const clients = streamClients.get(id);
          if (!clients) {
            return;
          }
          clients.delete(client);
          if (clients.size === 0) {
            streamClients.delete(id);
          }
        });
        return;
      }
      const id = url.pathname.replace("/api/agent/", "").trim();
      const session = sessions.get(id);
      if (!session) {
        sendJson(res, 404, { ok: false, error: "session not found" });
        return;
      }
      sendJson(res, 200, { ok: true, session });
      return;
    }

    if (url.pathname === "/main" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(buildMainTerminalHtml(options.token));
      return;
    }

    if (url.pathname === "/agent" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(buildAgentWindowPageHtml(options.token));
      return;
    }

    if (url.pathname === "/" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(buildDashboardPageHtml(options.token));
      return;
    }

    res.statusCode = 404;
    res.end("Not found");
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`);
    if (!url.pathname.startsWith("/ws/main/")) {
      socket.destroy();
      return;
    }
    if (!isAuthorized(url)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    mainPaneWs.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      mainPaneWs.emit("connection", ws, req);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port, options.host, () => resolve());
  });

  const queryToken = options.token ? `?token=${encodeURIComponent(options.token)}` : "";
  const localUrl = `http://127.0.0.1:${options.port}${queryToken}`;
  const boundUrl = `http://${options.host}:${options.port}${queryToken}`;
  process.stdout.write(`[winnow-ui] running at ${boundUrl}\n`);
  if (options.token) {
    process.stdout.write(`[winnow-ui] access token: ${options.token}\n`);
  }
  if (options.host === "0.0.0.0") {
    const ifaces = networkInterfaces();
    const ips: string[] = [];
    for (const values of Object.values(ifaces)) {
      for (const iface of values ?? []) {
        if (iface.family === "IPv4" && !iface.internal) {
          ips.push(iface.address);
        }
      }
    }
    if (ips.length > 0) {
      process.stdout.write(`[winnow-ui] LAN URLs:\n`);
      for (const ip of ips) {
        process.stdout.write(`  - http://${ip}:${options.port}${queryToken}\n`);
      }
    }
  } else {
    process.stdout.write(`[winnow-ui] local URL: ${localUrl}\n`);
  }
  process.stdout.write("[winnow-ui] press Ctrl+C to stop\n");
  if (options.openBrowser) {
    maybeOpenBrowser(options.host === "0.0.0.0" ? localUrl : boundUrl);
  }
}
