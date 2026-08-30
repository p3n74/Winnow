import { createServer, IncomingMessage } from "node:http";
import { appendFile, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { accessSync, constants as fsConstants, createReadStream, readFileSync } from "node:fs";
import { arch, cpus, freemem, homedir, loadavg, networkInterfaces, platform, totalmem, uptime } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";
import pty from "node-pty";
import { spawnCommand } from "../cursor/spawnCommand.js";
import { loadConfigFromEnv, WinnowConfig } from "../config/schema.js";
import { getStatusSnapshot } from "./status.js";
import {
  applyProjectProfile,
  loadProjectProfile,
  saveProjectProfile,
} from "../config/projectProfile.js";
import { loadDotenvFromDisk, readDotenvFile, WINNOW_DOTENV_SPECS, writeDotenvFileFull } from "../config/dotenvFile.js";
import {
  ExternalProvider,
  getProviderDefinition,
  PROVIDERS,
  readProviderVerificationStore,
  writeProviderVerificationStore,
} from "../config/providerRegistry.js";
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
  recomputeAllRunCosts,
  recordRunUsage,
  upsertRunStart,
  usageDbStatus,
} from "../data/usageStore.js";
import { getDefaultUsdPerMillion, pricingOverridePath, setDefaultUsdPerMillion } from "../data/pricing.js";
import { buildDiskDashboard } from "../data/diskSnapshotService.js";
import { collectSystemLive } from "../data/systemTelemetry.js";
import { SystemTelemetryStore } from "../data/systemTelemetryStore.js";
import { ProcessManager } from "../data/processManager.js";
import { closeProjectSqlite } from "../data/projectDb.js";
import { buildEfficiencyAdvisories } from "../data/efficiencyAdvisor.js";
import { PlanStore } from "../data/planStore.js";
import { reconcilePlan, syncPlanTasksToGithub } from "../data/planGithubSync.js";
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
  isCursorChatSessionId,
  resolveCursorResumeId,
} from "../cursor/sessionUtils.js";
import {
  parseCursorModelsOutput,
  type CursorModelOption,
} from "../cursor/modelCatalog.js";
import {
  extractLoginUrl,
  mergeCursorAccount,
  parseCursorAboutPayload,
  parseCursorStatusPayload,
  parseCursorUpdateOutput,
  type CursorAccountSnapshot,
} from "../cursor/cursorAccount.js";
import {
  MAX_ATTACHMENTS_PER_SEND,
  buildAttachmentPromptBlock,
  resolveStoredAttachments,
  saveAttachment,
} from "../cursor/attachments.js";
import {
  ASK_MODE_PROMPT_PREFIX,
  PLAN_MODE_PROMPT_PREFIX,
  ensureCursorModeArg,
  normalizeCursorMode,
} from "../cursor/cursorMode.js";
import { expandSlashPrompt, listSlashCatalog } from "../cursor/slashCatalog.js";
import {
  extractLiveSubagentEvents,
  listSubagentDefinitionFiles,
  SUBAGENTS_HINT,
  withBuiltinSubagents,
  type LiveSubagentRow,
} from "../cursor/subagents.js";
import { assistantTextFromStreamEvent, shouldAppendAssistantStreamEvent } from "../cursor/streamJson.js";

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
  type ManagedProcessStartRequest,
  type UiOptions,
} from "./ui/types.js";
import { sendJson, readJsonBody, sendHandlerError, applySecurityHeaders, applyNoStore } from "./ui/httpUtil.js";
import {
  installDeadPtyResizeGuard,
  paneLaunchScript,
  quoteExecutableForBash,
  safePtyResize,
  safePtyWrite,
} from "./ui/ptyUtil.js";
import {
  authorizeAccess,
  buildUiAccessCookie,
  isForwardedHttps,
  isPublicHealthRequest,
  shouldSetAccessCookie,
  UI_HEALTH_PAYLOAD,
} from "./ui/accessAuth.js";
import { findChromeExecutable, HostChromePreview } from "./ui/chromePreview.js";
import {
  isValidPreviewPort,
  probeLoopbackPort,
  proxyPreviewHttp,
  proxyPreviewWebSocket,
  resolvePreviewTarget,
} from "./ui/previewProxy.js";
import { agentStartRequestSchema, graphCorrectionsBodySchema, planCreateBodySchema } from "./ui/apiSchemas.js";
import {
  AgentStartBlockedError,
  MAX_CONCURRENT_AGENT_RUNS,
  MAX_STDOUT_LINE_BUFFER,
  assertAgentStartAllowed,
  capSessionBuffers,
  countRunningSessions,
  enqueueExclusiveWrite,
  ensureHeadlessWorkspaceArgs,
  evictIdleSessions,
  listRunningSessions,
  toSessionClientDto,
} from "./ui/sessionDto.js";
import {
  buildResolverPrompt,
  extractWrittenPathFromToolEvent,
  findPathOverlaps,
} from "./ui/agentOverlap.js";
import { readCursorSession } from "./ui/cursorSessionRead.js";
import { pickActiveAgentSession } from "./ui/agentTrace.js";
import { buildMainTerminalHtml } from "./ui/mainGridHtml.js";
import { buildDashboardPageHtml } from "./ui/dashboardHtml.js";
import { buildAgentGraphContextPreamble } from "../graph/agentGraphSeed.js";
import { ProjectGraphService } from "../graph/service.js";
import { smokeTestProvider } from "../translator/providerSmoke.js";
import { ExternalChatMessage, runExternalChatCompletion } from "../translator/externalChat.js";
import {
  rebuildAndWriteScriptIndex,
  resolveScriptFilePath,
} from "./scriptIndex.js";
import {
  SCRIPT_RUN_DEFAULTS,
  buildInspectPrompt,
  buildProposePrompt,
  buildSpawnArgv,
  buildSummarizePrompt,
  formatCommandPreview,
  mergeKnobs,
  parseInspectedKnobs,
  parseProposedCommand,
  shouldStopForMaxRuntime,
  shouldWarnStall,
} from "./scriptGuide.js";
import { ScriptStore } from "../data/scriptStore.js";

function applyMode(config: WinnowConfig, mode: "zh" | "raw" | "dual"): WinnowConfig {
  if (mode === "zh") {
    return { ...config, outputMode: "en_to_zh", showOriginal: false, dualOutput: false };
  }
  if (mode === "dual") {
    return { ...config, outputMode: "en_to_zh", showOriginal: true, dualOutput: true };
  }
  return { ...config, inputMode: "off", outputMode: "off", showOriginal: false, dualOutput: false };
}

/** Pinned Electron for `npx` so first-time --shell behavior is reproducible. */
const ELECTRON_UI_PIN = "33.2.0";

function maybeOpenBrowser(url: string): void {
  if (process.platform === "darwin") {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    return;
  }
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true, windowsHide: true }).unref();
    return;
  }
  spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
}

function resolveElectronAppMainPath(): string {
  const besideThisModule = join(dirname(fileURLToPath(import.meta.url)), "electronAppMain.cjs");
  try {
    accessSync(besideThisModule, fsConstants.R_OK);
    return besideThisModule;
  } catch {
    // e.g. dev from repo root while cwd differs
  }
  const fromRepo = resolve(process.cwd(), "src/cli/electronAppMain.cjs");
  try {
    accessSync(fromRepo, fsConstants.R_OK);
    return fromRepo;
  } catch {
    return besideThisModule;
  }
}

function spawnDesktopShell(loadUrl: string): void {
  const mainEntry = resolveElectronAppMainPath();
  try {
    accessSync(mainEntry, fsConstants.R_OK);
  } catch {
    process.stderr.write(`[winnow-ui] Electron shell: missing ${mainEntry}\n`);
    process.stderr.write(`[winnow-ui] run npm run build, or open manually: ${loadUrl}\n`);
    return;
  }
  const isWin = process.platform === "win32";
  const runner = isWin ? "npx.cmd" : "npx";
  const args = ["-y", `electron@${ELECTRON_UI_PIN}`, mainEntry, loadUrl];
  const child = spawn(runner, args, {
    stdio: "inherit",
    env: process.env,
    shell: isWin,
  });
  child.on("error", (err: NodeJS.ErrnoException) => {
    process.stderr.write(`[winnow-ui] Electron shell failed (${err.code ?? err.message}).\n`);
    process.stderr.write(`[winnow-ui] ensure npx is on PATH; first --shell may download Electron.\n`);
    process.stderr.write(`[winnow-ui] UI is still running at: ${loadUrl}\n`);
  });
}

export async function runUiServer(baseConfig: WinnowConfig, options: UiOptions): Promise<void> {
  installDeadPtyResizeGuard();
  let config = { ...baseConfig };
  const winnowLaunchRoot = resolve(process.cwd());
  const uiWorkspace = { dir: winnowLaunchRoot };
  const graphService = new ProjectGraphService();
  let processManager = new ProcessManager(uiWorkspace.dir);
  let telemetryStore = new SystemTelemetryStore(uiWorkspace.dir);
  let planStore = new PlanStore(uiWorkspace.dir);
  let scriptStore = new ScriptStore(uiWorkspace.dir);

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
    const previousRoot = uiWorkspace.dir;
    if (previousRoot !== real) {
      // Managed shell processes are project-scoped and are stopped. Live cursor-agent
      // children keep running in the cwd they were spawned with.
      try {
        await processManager.stopAll();
      } catch (error) {
        process.stderr.write(
          `[winnow-ui] stopAll on workspace switch failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
      processManager.close();
      closeProjectSqlite(previousRoot);
    }
    uiWorkspace.dir = real;
    processManager = new ProcessManager(uiWorkspace.dir);
    await processManager.init();
    telemetryStore = new SystemTelemetryStore(uiWorkspace.dir);
    await telemetryStore.init();
    planStore = new PlanStore(uiWorkspace.dir);
    planStore.init();
    await planStore.backfillFromMarkdownFiles();
    scriptStore = new ScriptStore(uiWorkspace.dir);
    scriptStore.init();
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
  await processManager.init();
  await telemetryStore.init();
  planStore.init();
  await planStore.backfillFromMarkdownFiles();
  scriptStore.init();

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

  async function listProviderStatus() {
    const envFile = readDotenvFile(winnowLaunchRoot);
    const verified = await readProviderVerificationStore(winnowLaunchRoot);
    return PROVIDERS.map((provider) => {
      const key = String(process.env[provider.envKey] ?? envFile[provider.envKey] ?? "").trim();
      return {
        provider: provider.id,
        label: provider.label,
        envKey: provider.envKey,
        hasKey: key.length > 0,
        verifiedAt: verified[provider.id]?.verifiedAt ?? null,
        models: verified[provider.id]?.models ?? [],
        baseUrl: verified[provider.id]?.baseUrl ?? "",
        supportsCustomBaseUrl: Boolean(provider.supportsCustomBaseUrl),
        requiresModelOnSmoke: Boolean(provider.requiresModelOnSmoke),
      };
    });
  }

  async function listPlans(): Promise<{ id: string; title: string; path: string; updatedAt: string }[]> {
    return planStore.list().map((p) => ({
      id: p.id,
      title: p.title,
      path: p.mdPath,
      updatedAt: p.updatedAt,
    }));
  }

  async function readPlanMarkdown(planId: string): Promise<{ ok: true; id: string; title: string; markdown: string } | { ok: false; error: string }> {
    const id = String(planId || "").trim();
    if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) {
      return { ok: false, error: "invalid plan id" };
    }
    return planStore.readMarkdown(id);
  }

  async function upsertProviderVerification(
    provider: ExternalProvider,
    models: string[],
    options?: { baseUrl?: string },
  ): Promise<void> {
    const store = await readProviderVerificationStore(winnowLaunchRoot);
    store[provider] = {
      provider,
      verifiedAt: new Date().toISOString(),
      models,
      ...(options?.baseUrl ? { baseUrl: options.baseUrl } : {}),
    };
    await writeProviderVerificationStore(winnowLaunchRoot, store);
  }

  /**
   * Cache of cursor-agent's `models` listing.
   * Keys are normalized model ids (e.g. `gpt-5.5-medium`).
   * Values are the friendly labels that cursor-agent reports back in `system.init`
   * (e.g. `GPT-5.5 1M`). Used to detect a model mismatch between the requested
   * `--model` and the model cursor-agent actually resolved.
   */
  let cursorModelLabelCache: Map<string, string> | undefined;
  let cursorModelOptionsCache: CursorModelOption[] = [];
  let cursorLoginChild: ChildProcess | null = null;
  let cursorLoginOutput = "";

  function spawnCursorCapture(args: string[], timeoutMs = 20000): Promise<string> {
    const cursorExe = (config.cursorCommand || "").trim() || "cursor-agent";
    return new Promise((resolvePromise) => {
      const child = spawnCommand(cursorExe, args, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: uiWorkspace.dir,
        env: process.env,
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
      }, timeoutMs);
      child.stdout?.on("data", (buf: Buffer) => {
        stdout += buf.toString("utf8");
      });
      child.stderr?.on("data", (buf: Buffer) => {
        stderr += buf.toString("utf8");
      });
      const finish = () => {
        clearTimeout(timer);
        resolvePromise((stdout.trim() || stderr).trim());
      };
      child.on("error", (error) => {
        clearTimeout(timer);
        resolvePromise(error.message);
      });
      child.on("close", finish);
    });
  }

  async function readCursorAccount(): Promise<CursorAccountSnapshot> {
    const statusRaw = await spawnCursorCapture(["status", "--format", "json"], 15000);
    const aboutRaw = await spawnCursorCapture(["about", "--format", "json"], 15000);
    return mergeCursorAccount({
      status: parseCursorStatusPayload(statusRaw),
      about: parseCursorAboutPayload(aboutRaw),
    });
  }

  async function bootstrapCursorCli(): Promise<CursorAccountSnapshot> {
    const updateRaw = await spawnCursorCapture(["update"], 45000);
    const update = parseCursorUpdateOutput(updateRaw);
    const account = await readCursorAccount();
    return mergeCursorAccount({
      status: {
        loggedIn: account.loggedIn,
        email: account.email,
        userId: account.userId,
      },
      about: {
        email: account.email,
        subscriptionTier: account.subscriptionTier,
        cliVersion: account.cliVersion,
      },
      update,
    });
  }

  function stopCursorLogin(): void {
    if (cursorLoginChild && cursorLoginChild.exitCode === null) {
      cursorLoginChild.kill("SIGTERM");
    }
    cursorLoginChild = null;
  }

  function startCursorLogin(): { started: boolean; alreadyRunning: boolean; loginUrl: string } {
    if (cursorLoginChild && cursorLoginChild.exitCode === null) {
      return { started: true, alreadyRunning: true, loginUrl: extractLoginUrl(cursorLoginOutput) };
    }
    const cursorExe = (config.cursorCommand || "").trim() || "cursor-agent";
    cursorLoginOutput = "";
    cursorLoginChild = spawnCommand(cursorExe, ["login"], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: uiWorkspace.dir,
      env: process.env,
    });
    const child = cursorLoginChild;
    child.stdout?.on("data", (buf: Buffer) => {
      cursorLoginOutput += buf.toString("utf8");
    });
    child.stderr?.on("data", (buf: Buffer) => {
      cursorLoginOutput += buf.toString("utf8");
    });
    child.on("close", () => {
      if (cursorLoginChild === child) {
        cursorLoginChild = null;
      }
    });
    child.on("error", () => {
      if (cursorLoginChild === child) {
        cursorLoginChild = null;
      }
    });
    return { started: true, alreadyRunning: false, loginUrl: "" };
  }

  async function readCursorModelsRaw(): Promise<string> {
    const fromFlag = await spawnCursorCapture(["--list-models"], 25000);
    if (parseCursorModelsOutput(fromFlag).length > 0) {
      return fromFlag;
    }
    return spawnCursorCapture(["models"], 25000);
  }

  async function loadCursorModelLabels(refresh = false): Promise<Map<string, string>> {
    if (cursorModelLabelCache && !refresh) {
      return cursorModelLabelCache;
    }
    const cliOutput = await readCursorModelsRaw();
    const options = parseCursorModelsOutput(cliOutput);
    const map = new Map<string, string>();
    for (const option of options) {
      map.set(option.id.toLowerCase(), option.label);
      map.set(option.id, option.label);
    }
    cursorModelOptionsCache = options;
    cursorModelLabelCache = map;
    return map;
  }

  async function listSelectableModels(): Promise<CursorModelOption[]> {
    await loadCursorModelLabels(true);
    return cursorModelOptionsCache;
  }

  async function listExternalSelectableModels(): Promise<string[]> {
    const verified = await readProviderVerificationStore(winnowLaunchRoot);
    const set = new Set<string>();
    for (const provider of PROVIDERS) {
      const models = verified[provider.id]?.models ?? [];
      for (const model of models) {
        if (provider.id === "deepseek" && model.trim().toLowerCase() === "deepseek-v3") {
          continue;
        }
        set.add(`${provider.id}:${model}`);
      }
    }
    return [...set];
  }

  function parseExternalModelSelection(selection: string): { provider?: ExternalProvider; model: string } {
    const trimmed = selection.trim();
    const idx = trimmed.indexOf(":");
    if (idx > 0) {
      const maybeProvider = trimmed.slice(0, idx).trim() as ExternalProvider;
      if (PROVIDERS.some((p) => p.id === maybeProvider)) {
        return { provider: maybeProvider, model: trimmed.slice(idx + 1).trim() };
      }
    }
    return { provider: undefined, model: trimmed };
  }

  function providerForModel(model: string): ExternalProvider | undefined {
    const normalized = model.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    if (normalized.startsWith("deepseek")) return "deepseek";
    if (normalized.startsWith("gpt-") || normalized.startsWith("o1") || normalized.startsWith("o3") || normalized.startsWith("o4")) return "openai";
    if (normalized.startsWith("claude")) return "anthropic";
    if (normalized.startsWith("gemini")) return "gemini";
    return undefined;
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

  function localSessionDir(projectRoot = uiWorkspace.dir): string {
    return join(projectRoot, ".winnow", "sessions");
  }

  function localSessionIndexPath(projectRoot = uiWorkspace.dir): string {
    return join(localSessionDir(projectRoot), "index.json");
  }

  function localSessionRecordPath(id: string, projectRoot = uiWorkspace.dir): string {
    return join(localSessionDir(projectRoot), `${id}.json`);
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
            cursorSessionId: record.cursorSessionId,
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

  async function upsertLocalSessionIndex(
    entry: LocalSessionIndexEntry,
    projectRoot = uiWorkspace.dir,
  ): Promise<void> {
    const root = projectRoot || uiWorkspace.dir;
    const run = async (): Promise<void> => {
      const dir = localSessionDir(root);
      const indexPath = localSessionIndexPath(root);
      let current: LocalSessionIndexEntry[] = [];
      try {
        const parsed = JSON.parse(await readFile(indexPath, "utf8")) as LocalSessionIndexEntry[];
        current = Array.isArray(parsed) ? parsed : [];
      } catch {
        current = [];
      }
      const next = [entry, ...current.filter((item) => item.id !== entry.id)]
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, 500);
      await mkdir(dir, { recursive: true });
      await writeFile(indexPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    };
    await enqueueExclusiveWrite(sessionRecordWriteChains, `index:${root}`, run).catch((err) => {
      process.stderr.write(`[winnow-ui] session index update failed: ${(err as Error).message}\n`);
    });
  }

  const sessionRecordWriteChains = new Map<string, Promise<void>>();

  async function writeLocalSessionRecord(record: LocalSessionRecord): Promise<void> {
    const dir = localSessionDir(record.projectRoot || uiWorkspace.dir);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${record.id}.json`), `${JSON.stringify(record)}\n`, "utf8");
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
      cursorSessionId: entry.cursorSessionId,
      status: entry.status,
      startedAt: entry.startedAt,
      source: entry.source,
    }));
  }

  async function readLocalSession(
    id: string,
    projectRoot = uiWorkspace.dir,
  ): Promise<{ id: string; messages: SessionMessage[]; cursorSessionId?: string }> {
    const content = await readFile(localSessionRecordPath(id, projectRoot), "utf8");
    const record = JSON.parse(content) as LocalSessionRecord;
    if (Array.isArray(record.events) && record.events.length > 0) {
      const messages = record.events.map((event) => ({
        id: event.id,
        role: event.kind,
        content: event.content,
        timestamp: event.ts,
      }));
      return { id, messages, cursorSessionId: record.cursorSessionId };
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
    return { id, messages, cursorSessionId: record.cursorSessionId };
  }

  const sessions = new Map<string, AgentSession>();
  const streamClients = new Map<string, Set<SessionStreamClient>>();
  /** Live cursor-agent child processes keyed by session id (for cancel / stop). */
  const agentRunChildProcesses = new Map<string, ChildProcess>();
  /** Write-ish tool paths touched by each in-memory session (collision detection). */
  const sessionWrittenPaths = new Map<string, Set<string>>();

  const firstUserPreview = (session: AgentSession): string => {
    const user = (session.events ?? []).find((event) => event.kind === "user");
    return (user?.content || session.output || "").replace(/\s+/g, " ").slice(0, 160);
  };

  const runningOverlapPayload = async (): Promise<{
    overlaps: ReturnType<typeof findPathOverlaps>;
    sessions: Array<{ id: string; preview: string; writtenPaths: string[] }>;
    gitStatus: string;
    gitDiffExcerpt: string;
    resolverPrompt: string;
  }> => {
    const running = listRunningSessions(sessions.values());
    const bySession = new Map<string, Iterable<string>>();
    const summaries = running.map((session) => {
      const writtenPaths = [...(sessionWrittenPaths.get(session.id) ?? [])].sort();
      bySession.set(session.id, writtenPaths);
      return { id: session.id, preview: firstUserPreview(session), writtenPaths };
    });
    const overlaps = findPathOverlaps(bySession);
    const workspace = await getWorkspaceChanges();
    const gitStatus = workspace.status || "";
    const gitDiffExcerpt = (workspace.diff || "").slice(0, 12000);
    return {
      overlaps,
      sessions: summaries,
      gitStatus,
      gitDiffExcerpt,
      resolverPrompt: buildResolverPrompt({
        overlaps,
        sessions: summaries,
        gitStatus,
        gitDiffExcerpt,
      }),
    };
  };
  const nodeMajor = Number(process.versions.node.split(".")[0] || "0");
  const supportsPty = nodeMajor >= 20;

  const corsOrigin = options.corsOrigin?.trim() || undefined;

  const paneCommands: Record<PaneId, string> = {
    ...DEFAULT_PANE_COMMANDS,
    ...(options.paneCommands ?? {}),
  };
  const mainPaneSessions = new Map<PaneId, { ws: WebSocket; ptyProcess: pty.IPty }>();
  const mainPaneWs = new WebSocketServer({ noServer: true });
  const chromePreviewWs = new WebSocketServer({ noServer: true });
  let hostChrome: HostChromePreview | null = null;
  let hostChromeLaunch: Promise<HostChromePreview> | null = null;

  const chromePreviewClients = new Set<WebSocket>();

  const ensureHostChrome = async (): Promise<HostChromePreview> => {
    if (hostChrome) {
      return hostChrome;
    }
    if (!hostChromeLaunch) {
      hostChromeLaunch = HostChromePreview.tryLaunch()
        .then((session) => {
          session.onFrame((frame) => {
            const payload = JSON.stringify({ type: "frame", data: frame.data, metadata: frame.metadata });
            for (const client of chromePreviewClients) {
              if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
              }
            }
          });
          return session;
        })
        .catch((error: unknown) => {
          hostChromeLaunch = null;
          throw error;
        });
    }
    hostChrome = await hostChromeLaunch;
    return hostChrome;
  };

  const closeHostChrome = (): void => {
    const session = hostChrome;
    hostChrome = null;
    hostChromeLaunch = null;
    if (session) {
      void session.close();
    }
  };
  process.once("exit", () => {
    closeHostChrome();
  });

  chromePreviewWs.on("connection", (ws: WebSocket) => {
    chromePreviewClients.add(ws);
    const send = (payload: unknown): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };
    void (async () => {
      try {
        const chrome = await ensureHostChrome();
        send({ type: "ready", chromePath: chrome.chromePath });
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.message : String(error) });
      }
    })();
    ws.on("message", (raw) => {
      void (async () => {
        let msg: {
          type?: string;
          url?: string;
          width?: number;
          height?: number;
          event?: string;
          x?: number;
          y?: number;
          canvasWidth?: number;
          canvasHeight?: number;
          deltaX?: number;
          deltaY?: number;
          key?: string;
          code?: string;
          text?: string;
        };
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        try {
          const chrome = await ensureHostChrome();
          if (msg.type === "open" && typeof msg.url === "string") {
            if (msg.width && msg.height) {
              await chrome.setViewport(msg.width, msg.height);
            }
            const nav = await chrome.navigate(msg.url);
            send({ type: "status", url: nav.href, chrome: true });
            return;
          }
          if (msg.type === "reload") {
            await chrome.reload();
            return;
          }
          if (msg.type === "back") {
            await chrome.history(-1);
            return;
          }
          if (msg.type === "forward") {
            await chrome.history(1);
            return;
          }
          if (msg.type === "resize" && msg.width && msg.height) {
            await chrome.setViewport(msg.width, msg.height);
            return;
          }
          if (msg.type === "mouse") {
            const event =
              msg.event === "down" ? "mousePressed" : msg.event === "up" ? "mouseReleased" : msg.event === "wheel" ? "mouseWheel" : "mouseMoved";
            await chrome.mouse({
              type: event,
              x: Number(msg.x) || 0,
              y: Number(msg.y) || 0,
              canvasWidth: Number(msg.canvasWidth) || 1,
              canvasHeight: Number(msg.canvasHeight) || 1,
              deltaX: msg.deltaX,
              deltaY: msg.deltaY,
            });
            return;
          }
          if (msg.type === "key" && msg.key && msg.code) {
            const event = msg.event === "up" ? "keyUp" : msg.event === "char" ? "char" : "keyDown";
            await chrome.key({ type: event, key: msg.key, code: msg.code, text: msg.text });
          }
        } catch (error) {
          send({ type: "error", error: error instanceof Error ? error.message : String(error) });
        }
      })();
    });
    ws.on("close", () => {
      chromePreviewClients.delete(ws);
    });
  });
  const logMainPane = (message: string): void => {
    process.stdout.write(`[winnow-ui][main-pane] ${message}\n`);
  };

  const closeMainPane = (paneId: PaneId): void => {
    const existing = mainPaneSessions.get(paneId);
    if (!existing) {
      return;
    }
    logMainPane(`closing pane=${paneId}`);
    try {
      existing.ptyProcess.kill();
    } catch {
      // ignore
    }
    mainPaneSessions.delete(paneId);
  };

  const listShellCandidates = (): string[] => {
    if (platform() === "win32") {
      const programFiles = process.env.ProgramFiles || "C:\\Program Files";
      const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
      return [join(programFiles, "Git", "bin", "bash.exe"), join(programFilesX86, "Git", "bin", "bash.exe")];
    }
    return [process.env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"].filter(
      (value): value is string => Boolean(value && value.trim()),
    );
  };

  const resolveInteractiveShellForPty = (): string => {
    const checker = platform() === "win32" ? fsConstants.F_OK : fsConstants.X_OK;
    for (const candidate of listShellCandidates()) {
      try {
        accessSync(candidate, checker);
        return candidate;
      } catch {
        // try next
      }
    }
    if (platform() === "win32") {
      throw new Error(
        "Git Bash not found for PTY panes. Install Git for Windows (https://git-scm.com/download/win) and retry.",
      );
    }
    throw new Error("no executable shell found for PTY");
  };

  const spawnMainPane = (paneId: PaneId): pty.IPty => {
    const shell = resolveInteractiveShellForPty();
    const rawCommand = (paneCommands[paneId] || "").trim();
    const quotedShell = quoteExecutableForBash(shell);
    const launchScript = paneLaunchScript(shell, rawCommand, quotedShell);
    if (rawCommand && launchScript.startsWith("exec ")) {
      logMainPane(`pane=${paneId} ${rawCommand} not on PATH; starting shell`);
    }
    try {
      // Use `-c` (not `-lc`) so panes start as normal interactive shells without forcing a login-shell profile pass.
      return pty.spawn(shell, ["-c", launchScript], {
        name: "xterm-256color",
        cols: 120,
        rows: 36,
        cwd: uiWorkspace.dir,
        env: process.env as Record<string, string>,
      });
    } catch {
      for (const candidate of listShellCandidates()) {
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
            `[use Node 22+ and rerun: npm run setup]\r\n`,
        );
      }
      ws.close(1011, "unsupported node version for pty");
      return;
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`);
    const paneId = url.pathname.split("/").pop() as PaneId;
    if (!paneId || !["1", "2", "3", "4", "5"].includes(paneId)) {
      logMainPane(`reject invalid pane id path=${url.pathname}`);
      ws.close(1008, "invalid pane id");
      return;
    }

    closeMainPane(paneId);
    let ptyProcess: pty.IPty;
    try {
      ptyProcess = spawnMainPane(paneId);
      logMainPane(`spawned pane=${paneId} cwd=${uiWorkspace.dir}`);
    } catch (error) {
      logMainPane(`spawn failed pane=${paneId} error=${(error as Error).message}`);
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
      logMainPane(`pane exit pane=${paneId} code=${exitCode}`);
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
          safePtyWrite(live.ptyProcess, message.data);
        } else if (message.type === "resize" && Number.isFinite(message.cols) && Number.isFinite(message.rows)) {
          safePtyResize(live.ptyProcess, Number(message.cols), Number(message.rows));
        }
      } catch {
        // ignore malformed client message
      }
    });
    ws.on("close", () => {
      logMainPane(`ws closed pane=${paneId}`);
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

  const notifyRunningAgentsOfCwdChange = (previousDir: string, nextDir: string) => {
    if (previousDir === nextDir) {
      return;
    }
    const ts = new Date().toISOString();
    for (const session of sessions.values()) {
      if (session.status !== "running") {
        continue;
      }
      const home = session.projectRoot || previousDir;
      const content =
        home === nextDir
          ? `Winnow working directory is now ${nextDir}.`
          : `Winnow working directory is now ${nextDir}. This agent keeps running in ${home}.`;
      const event = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts,
        kind: "status" as const,
        content,
      };
      session.events.push(event);
      capSessionBuffers(session);
      pushStreamEvent(session.id, "timeline", { sessionId: session.id, event });
    }
  };

  const forceCursorNativeConfig = (input: WinnowConfig): WinnowConfig => ({
    ...input,
    inputMode: "off",
    outputMode: "off",
    showOriginal: false,
    dualOutput: false,
  });

  const parseArgs = (raw: string): string[] => raw.split(/\s+/).map((x) => x.trim()).filter(Boolean);
  const isGenericCursorModel = (model: string | undefined): boolean => {
    const normalized = (model || "").trim().toLowerCase();
    return !normalized || normalized === "default" || normalized === "auto" || normalized === "composer";
  };
  const isExplicitGenericCursorModel = (model: string | undefined): boolean => {
    const normalized = (model || "").trim().toLowerCase();
    return normalized === "default" || normalized === "auto" || normalized === "composer";
  };
  const stripModelArgs = (args: string[]): string[] => {
    const next: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === "--model") {
        i += 1;
        continue;
      }
      if (arg.startsWith("--model=")) {
        continue;
      }
      next.push(arg);
    }
    return next;
  };
  const stripResumeArgs = (args: string[]): { stripped: string[]; removed: string[] } => {
    const stripped: string[] = [];
    const removed: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === "--resume") {
        const value = args[i + 1];
        if (value !== undefined) {
          removed.push(value);
          i += 1;
        }
        continue;
      }
      if (arg.startsWith("--resume=")) {
        removed.push(arg.slice("--resume=".length));
        continue;
      }
      stripped.push(arg);
    }
    return { stripped, removed };
  };
  const ensureModelArg = (args: string[], preference: string): string[] => {
    const selected = (preference || "default").trim();
    if (!selected || selected === "default") {
      return args;
    }
    const value = selected;
    return [...stripModelArgs(args), "--model", value];
  };
  const ensureExecutionArgs = (
    args: string[],
    autonomyEnabled: boolean,
    sessionId?: string,
    workspaceDir?: string,
  ): string[] => {
    let next = [...args];
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
    if (workspaceDir) {
      next = ensureHeadlessWorkspaceArgs(next, workspaceDir);
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
    const executionMode = payload.executionMode === "external" ? "external" : "cursor";
    const cursorExe = (nativeConfig.cursorCommand || "").trim() || "cursor-agent";
    const id = (payload.sessionId || "").trim() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const rawArgs = parseArgs(payload.args ?? "");
    const { stripped: baseArgsNoResume, removed: removedResumeIds } = stripResumeArgs(rawArgs);
    const baseArgs = baseArgsNoResume;
    const autonomyEnabled = payload.autonomyMode !== false;
    const requestedResumeId = (payload.sessionId || "").trim();
    const existing = sessions.get(id);
    assertAgentStartAllowed(sessions, id);

    let diskEvents: AgentEvent[] = [];
    let diskOutput = "";
    let diskErrorOutput = "";
    let diskStartedAt = new Date().toISOString();
    let diskCursorSessionId = "";
    let diskCursorMode = "";
    if (!existing) {
      try {
        const recordPath = localSessionRecordPath(id);
        const content = readFileSync(recordPath, "utf8");
        const record = JSON.parse(content) as LocalSessionRecord;
        diskEvents = record.events || [];
        diskOutput = record.output || "";
        diskErrorOutput = record.errorOutput || "";
        diskStartedAt = record.startedAt || diskStartedAt;
        diskCursorSessionId = record.cursorSessionId || "";
        diskCursorMode = record.cursorMode || "";
      } catch {
        // New session or failed to read
      }
    }
    const spawnCwd = existing?.projectRoot || uiWorkspace.dir;
    const storedCursorSessionId = existing?.cursorSessionId || diskCursorSessionId || "";
    let { resumeId: resumeSessionId, droppedArgIds: droppedResumeIds } = resolveCursorResumeId({
      payloadSessionId: requestedResumeId,
      payloadCursorSessionId: String(payload.cursorSessionId || "").trim(),
      storedCursorSessionId,
      resumeArgIds: removedResumeIds,
    });
    if (requestedResumeId && executionMode === "cursor" && !resumeSessionId) {
      throw new Error(
        "Continue needs a Cursor chat UUID so the model can load native thread context. Uncheck continue to start a new chat, or run this session once so Winnow can store the id from cursor-agent.",
      );
    }
    // Cursor IDE mode (agent/ask/plan), not the execution backend. Agent passes no `--mode`.
    const cursorMode = normalizeCursorMode(payload.cursorMode ?? diskCursorMode);
    const args =
      executionMode === "cursor"
        ? ensureCursorModeArg(
            ensureExecutionArgs(
              ensureModelArg(baseArgs, payload.modelPreference ?? "default"),
              autonomyEnabled,
              resumeSessionId,
              spawnCwd,
            ),
            cursorMode,
          )
        : [];
    let session: AgentSession;

    if (existing) {
      session = {
        ...existing,
        status: "running",
        endedAt: undefined,
        error: undefined,
        command: executionMode === "external" ? "external-provider" : cursorExe,
        args,
        startedAt: existing.startedAt || new Date().toISOString(),
        events: existing.events ?? [],
        liveSubagents: [],
        cursorSessionId: existing.cursorSessionId || storedCursorSessionId || undefined,
        projectRoot: spawnCwd,
      };
    } else {
      session = {
        id,
        status: "running",
        startedAt: diskStartedAt,
        output: diskOutput,
        errorOutput: diskErrorOutput,
        command: executionMode === "external" ? "external-provider" : cursorExe,
        args,
        events: diskEvents,
        liveSubagents: [],
        cursorSessionId: storedCursorSessionId || undefined,
        projectRoot: spawnCwd,
      };
    }

    sessions.set(id, session);
    if (!sessionWrittenPaths.has(id)) {
      sessionWrittenPaths.set(id, new Set());
    }
    const startedAt = session.startedAt;
    const modelPreference = payload.modelPreference ?? "default";
    const attachmentIds = Array.isArray(payload.attachmentIds)
      ? payload.attachmentIds.slice(0, MAX_ATTACHMENTS_PER_SEND).map((value) => String(value))
      : [];
    const attachmentBlock = buildAttachmentPromptBlock(
      resolveStoredAttachments(uiWorkspace.dir, attachmentIds).map((item) => item.absPath),
    );
    const customModeSkill = String(payload.customModeSkill || "").trim();
    const slashExpanded = expandSlashPrompt({
      projectRoot: spawnCwd,
      userHomedir: homedir(),
      invocations: payload.slashInvocations,
      customModeSkill,
      userPrompt: payload.prompt,
    });
    const prompt = attachmentBlock ? `${slashExpanded}\n\n${attachmentBlock}` : slashExpanded;
    const planId = String(payload.planId || "").trim();
    const graphSeedEnabled = payload.graphSeed !== false && !resumeSessionId;
    const graphPreamble = graphSeedEnabled ? buildAgentGraphContextPreamble(graphService, uiWorkspace.dir, prompt) : "";
    const planContext = planId && !resumeSessionId ? await readPlanMarkdown(planId) : null;
    let selectedModelError: string | undefined;
    let initModelVerified = false;
    // Preload the id→label map so we can validate `system.init` synchronously below.
    const cursorModelLabels =
      executionMode === "cursor" && !isGenericCursorModel(modelPreference)
        ? await loadCursorModelLabels()
        : undefined;
    const expectedCursorLabel = cursorModelLabels?.get(modelPreference.trim().toLowerCase());
    const planPreamble =
      planContext && planContext.ok
        ? `## Active plan context\n\nPlan: ${planContext.title}\nPlan ID: ${planContext.id}\n\n${planContext.markdown.slice(0, 12000)}`
        : "";
    // Belt and suspenders: `--print` keeps write/shell tools, so ask/plan also ship as prompt text.
    const cursorModePreamble =
      cursorMode === "ask" ? ASK_MODE_PROMPT_PREFIX : cursorMode === "plan" ? PLAN_MODE_PROMPT_PREFIX : "";
    const composedPrompt =
      graphPreamble.trim().length > 0 || planPreamble.trim().length > 0
        ? `${[graphPreamble.trim(), planPreamble.trim()].filter(Boolean).join("\n\n---\n\n")}\n\n---\n\n## User request\n\n${prompt}`
        : prompt;
    const effectivePrompt = cursorModePreamble ? `${cursorModePreamble}\n\n---\n\n${composedPrompt}` : composedPrompt;

    let persistTimer: ReturnType<typeof setTimeout> | undefined;
    const persistRecord = (immediate = false) => {
      capSessionBuffers(session);
      const run = () =>
        enqueueExclusiveWrite(sessionRecordWriteChains, id, () =>
          writeLocalSessionRecord({
            id,
            projectRoot: spawnCwd,
            startedAt,
            endedAt: session.endedAt,
            status: session.status,
            args,
            modelPreference,
            prompt,
            output: session.output,
            errorOutput: session.errorOutput,
            events: session.events,
            cursorSessionId: session.cursorSessionId,
            cursorMode,
            customModeSkill: customModeSkill || undefined,
          }),
        );
      if (immediate) {
        if (persistTimer) {
          clearTimeout(persistTimer);
          persistTimer = undefined;
        }
        return run();
      }
      if (persistTimer) {
        return Promise.resolve();
      }
      persistTimer = setTimeout(() => {
        persistTimer = undefined;
        void run();
      }, 250);
      return Promise.resolve();
    };

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

    const upsertLiveSubagent = (row: LiveSubagentRow) => {
      if (!session.liveSubagents) {
        session.liveSubagents = [];
      }
      const idx = session.liveSubagents.findIndex((item) => item.id === row.id);
      if (idx >= 0) {
        session.liveSubagents[idx] = row;
      } else {
        session.liveSubagents.push(row);
      }
    };

    const abortOrThrow = (): void => {
      if (!signal?.aborted) {
        return;
      }
      session.status = "error";
      session.error = "Start cancelled";
      session.endedAt = new Date().toISOString();
      pushEvent("status", "Start cancelled.");
      void persistRecord(true);
      finalizeRun(id, "error", null, session.endedAt);
      void upsertLocalSessionIndex({
        id,
        startedAt,
        updatedAt: session.endedAt,
        status: "error",
        preview: prompt.slice(0, 160),
        source: "winnow-local",
        cursorSessionId: session.cursorSessionId,
      }, spawnCwd);
      closeStreamClients(id);
      sessionWrittenPaths.delete(id);
      sessions.delete(id);
      throw new DOMException("Start cancelled", "AbortError");
    };

    pushEvent("user", prompt);
    if (graphSeedEnabled && graphPreamble.trim().length > 0) {
      pushEvent("status", `Graph seed: prepended ${graphPreamble.length} characters of project-graph context.`);
    }
    if (planPreamble.trim().length > 0) {
      const scopedPlanName = planContext && planContext.ok ? planContext.title : planId;
      pushEvent("status", `Plan scope: prepended context from plan "${scopedPlanName}".`);
    } else if (planId && !resumeSessionId) {
      pushEvent("status", `Plan scope: selected plan "${planId}" was unavailable.`);
    }
    if (droppedResumeIds.length > 0) {
      pushEvent(
        "status",
        `Dropped invalid --resume id(s) from extra args: ${droppedResumeIds.join(", ")}. ` +
          "cursor-agent --resume only accepts Cursor chat UUIDs.",
      );
    }
    if (resumeSessionId) {
      if (!session.cursorSessionId) {
        session.cursorSessionId = resumeSessionId;
      }
      pushEvent("status", `Resuming Cursor chat ${resumeSessionId} (native thread, no local history dump).`);
    }

    ensureCursorWorkspaceLayoutSync(spawnCwd);
    void persistRecord(true);
    void upsertLocalSessionIndex({
      id,
      startedAt,
      updatedAt: startedAt,
      status: session.status,
      preview: prompt.slice(0, 160),
      source: "winnow-local",
      cursorSessionId: session.cursorSessionId,
    }, spawnCwd);

    upsertRunStart({
      id,
      projectPath: spawnCwd,
      projectName: basename(spawnCwd),
      source: executionMode === "external" ? "external-provider" : "cursor-agent",
      modelPref: modelPreference,
      startedAt,
      status: "running",
      promptPreview: prompt,
    });

    abortOrThrow();

    if (executionMode === "external") {
      const pushDone = () => {
        pushStreamEvent(id, "status", {
          status: session.status,
          exitCode: session.exitCode,
          endedAt: session.endedAt,
        });
        pushStreamEvent(id, "done", { sessionId: id });
        closeStreamClients(id);
      };
      const completeError = (errorMessage: string) => {
        session.status = "error";
        session.exitCode = 1;
        session.error = errorMessage;
        session.endedAt = new Date().toISOString();
        session.errorOutput += `${errorMessage}\n`;
        pushEvent("stderr", `${errorMessage}\n`);
        pushEvent("status", "❌ External run failed.");
        void persistRecord(true);
        finalizeRun(id, "error", 1, session.endedAt);
        void upsertLocalSessionIndex({
          id,
          startedAt,
          updatedAt: session.endedAt,
          status: "error",
          preview: (session.output || prompt).slice(0, 160),
          source: "winnow-local",
          cursorSessionId: session.cursorSessionId,
        }, spawnCwd);
        pushDone();
      };
      try {
        const model = (payload.modelPreference || "").trim();
        if (!model) {
          throw new Error("External mode requires a selected external model.");
        }
        const parsed = parseExternalModelSelection(model);
        const selectedModel = parsed.model;
        const provider = parsed.provider || providerForModel(selectedModel);
        if (!provider) {
          throw new Error(`Cannot infer provider for model "${model}".`);
        }
        const providerDef = getProviderDefinition(provider);
        const verified = await readProviderVerificationStore(winnowLaunchRoot);
        const universalBaseUrl = provider === "universal" ? String(verified.universal?.baseUrl ?? "").trim() : "";
        const envFile = readDotenvFile(winnowLaunchRoot);
        const apiKey = String(process.env[providerDef.envKey] ?? envFile[providerDef.envKey] ?? "").trim();
        if (!apiKey) {
          throw new Error(`Missing ${providerDef.envKey}. Add it in Settings and smoke test it first.`);
        }
        if (provider === "universal" && !universalBaseUrl) {
          throw new Error("Universal adapter base URL is missing. Configure it in Settings and run smoke test.");
        }
        const history = session.events
          .filter((e) => e.kind === "user" || e.kind === "assistant")
          .slice(-16)
          .map((e): ExternalChatMessage => ({
            role: e.kind === "user" ? "user" : "assistant",
            content: e.content,
          }));
        const workspace = await getWorkspaceChanges();
        const contextBlock =
          `Workspace: ${uiWorkspace.dir}\n` +
          `Changed files (${workspace.files.length}): ${workspace.files.slice(0, 60).join(", ") || "(none)"}\n` +
          `Git status:\n${workspace.status || "(none)"}\n` +
          `Diff excerpt:\n${(workspace.diff || "").slice(0, 12000) || "(none)"}`;
        const graphSeedBlock =
          graphPreamble.trim().length > 0
            ? [
                {
                  role: "system" as const,
                  content:
                    "Project graph seed (heuristic, may be incomplete). Prefer opening these files/symbols before scanning the whole tree.\n\n" +
                    graphPreamble.trim(),
                },
              ]
            : [];
        // External providers get no cursor-agent flags, so ask/plan is prompt-only here.
        const cursorModeBlock = cursorModePreamble
          ? [{ role: "system" as const, content: cursorModePreamble }]
          : [];
        const messages: ExternalChatMessage[] = [
          {
            role: "system",
            content:
              "You are a coding assistant running in Winnow external mode. Use conversation history and workspace snapshot context. " +
              "If context is insufficient, say exactly what additional files or commands are needed.",
          },
          { role: "system", content: contextBlock },
          ...cursorModeBlock,
          ...graphSeedBlock,
          ...history,
        ];
        const output = await runExternalChatCompletion({
          provider,
          model: selectedModel,
          apiKey,
          messages,
          deepseekBaseUrl: config.deepseekBaseUrl,
          universalBaseUrl,
        });
        session.output += output;
        capSessionBuffers(session);
        session.exitCode = 0;
        session.status = "done";
        session.endedAt = new Date().toISOString();
        pushEvent("assistant", output);
        pushEvent("status", "✓ External run completed.");
        void persistRecord(true);
        finalizeRun(id, "done", 0, session.endedAt);
        void upsertLocalSessionIndex({
          id,
          startedAt,
          updatedAt: session.endedAt,
          status: "done",
          preview: (session.output || prompt).slice(0, 160),
          source: "winnow-local",
          cursorSessionId: session.cursorSessionId,
        }, spawnCwd);
        pushDone();
      } catch (error) {
        completeError(error instanceof Error ? error.message : String(error));
      }
      return session;
    }

    pushEvent(
      "status",
      `Spawn: ${cursorExe} ${args.join(" ")} | modelPreference=${modelPreference || "(empty)"}`,
    );
    const child = spawnCommand(cursorExe, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: spawnCwd,
      env: process.env,
    });
    agentRunChildProcesses.set(id, child);

    child.on("error", (error) => {
      agentRunChildProcesses.delete(id);
      session.status = "error";
      session.error = error.message;
      session.endedAt = new Date().toISOString();
      pushEvent("status", `spawn error: ${error.message}`);
      void persistRecord(true);
      finalizeRun(id, "error", 1, session.endedAt);
    });

    let stdoutBuffer = "";
    child.stdout?.on("data", (buf: Buffer) => {
      stdoutBuffer += buf.toString("utf8");
      if (stdoutBuffer.length > MAX_STDOUT_LINE_BUFFER) {
        const dropped = stdoutBuffer.length - MAX_STDOUT_LINE_BUFFER;
        stdoutBuffer = stdoutBuffer.slice(-MAX_STDOUT_LINE_BUFFER);
        pushEvent("status", `stdout line buffer exceeded; dropped ${dropped} chars without a newline.`);
      }
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          const liveSubagent = extractLiveSubagentEvents(data);
          if (liveSubagent) {
            upsertLiveSubagent(liveSubagent);
            pushEvent(
              "system",
              `subagent ${liveSubagent.name}: ${liveSubagent.status} ${liveSubagent.summary}`.trim(),
            );
          }
          if (data.type === "system" && data.subtype === "init") {
            const cursorChatId = typeof data.session_id === "string" ? data.session_id.trim() : "";
            if (isCursorChatSessionId(cursorChatId) && session.cursorSessionId !== cursorChatId) {
              session.cursorSessionId = cursorChatId;
              pushEvent("status", `Cursor chat id ${cursorChatId}`);
              void persistRecord();
            }
            const reportedLabel = typeof data.model === "string" ? data.model.trim() : "";
            if (!isGenericCursorModel(modelPreference) && expectedCursorLabel) {
              const expected = expectedCursorLabel.trim().toLowerCase();
              const reported = reportedLabel.toLowerCase();
              if (!reported) {
                // No label reported (older cursor-agent); skip strict check, fall through to result.
              } else if (reported === expected) {
                initModelVerified = true;
                pushEvent("status", `Model verified: ${reportedLabel} (${modelPreference}).`);
              } else {
                selectedModelError =
                  `Selected model error: requested "${modelPreference}" (${expectedCursorLabel}) but cursor-agent ` +
                  `started with "${reportedLabel}". Stopping run to avoid false-positive model reporting.`;
                session.error = selectedModelError;
                session.errorOutput += `${selectedModelError}\n`;
                pushEvent("stderr", `${selectedModelError}\n`);
                pushEvent("status", `❌ ${selectedModelError}`);
                if (!child.killed) {
                  child.kill("SIGTERM");
                }
                continue;
              }
            }
          } else if (data.type === "assistant" && data.message?.content) {
            // stream-partial-output: append only timestamped deltas. Skip the
            // pre-tool-call flush (model_call_id) and the final turn flush (no timestamp_ms).
            if (shouldAppendAssistantStreamEvent(data)) {
              const text = assistantTextFromStreamEvent(data);
              if (text) {
                session.output += text;
                capSessionBuffers(session);
                pushEvent("assistant", text);
              }
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

            const writtenPath = extractWrittenPathFromToolEvent(data);
            if (writtenPath) {
              const bucket = sessionWrittenPaths.get(id) ?? new Set<string>();
              bucket.add(writtenPath);
              sessionWrittenPaths.set(id, bucket);
            }

            if (data.subtype === "completed") {
              session.output += "\n";
            }
          } else if (data.type === "result") {
            const resultChatId = typeof data.session_id === "string" ? data.session_id.trim() : "";
            if (isCursorChatSessionId(resultChatId) && session.cursorSessionId !== resultChatId) {
              session.cursorSessionId = resultChatId;
              pushEvent("status", `Cursor chat id ${resultChatId}`);
              void persistRecord();
            }
            if (data.subtype === "success") {
              const reportedModel = typeof data.model === "string" ? data.model.trim() : "";
              // Only the `system.init` event reliably contains the resolved model.
              // Here we only act on an explicit downgrade (auto/default/composer)
              // when init never confirmed our specific selection.
              if (
                !isGenericCursorModel(modelPreference) &&
                !initModelVerified &&
                isExplicitGenericCursorModel(reportedModel)
              ) {
                selectedModelError =
                  `Selected model error: requested "${modelPreference}" but cursor-agent ` +
                  `result reported "${reportedModel}". Stopping run to avoid false-positive model reporting.`;
                session.error = selectedModelError;
                session.errorOutput += `${selectedModelError}\n`;
                pushEvent("stderr", `${selectedModelError}\n`);
                pushEvent("status", `❌ ${selectedModelError}`);
                if (!child.killed) {
                  child.kill("SIGTERM");
                }
                continue;
              }
              if (data.usage) {
                recordRunUsage(id, {
                  inputTokens: Number(data.usage.inputTokens) || 0,
                  outputTokens: Number(data.usage.outputTokens) || 0,
                  // Prefer the verified model id over the friendly label cursor reports.
                  model:
                    initModelVerified && !isGenericCursorModel(modelPreference)
                      ? modelPreference
                      : reportedModel || undefined,
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
          capSessionBuffers(session);
          pushEvent("assistant", `${line}\n`);
        }
      }
      void persistRecord();
    });
    child.stderr?.on("data", (buf: Buffer) => {
      const chunk = buf.toString("utf8");
      session.errorOutput += chunk;
      capSessionBuffers(session);
      pushEvent("stderr", chunk);
      void persistRecord();
    });

    child.stdin?.write(`${effectivePrompt}\n`);
    child.stdin?.end();

    child.on("close", (code: number | null) => {
      agentRunChildProcesses.delete(id);
      void (async () => {
        session.exitCode = selectedModelError ? 1 : code ?? 1;
        session.status = selectedModelError ? "error" : session.exitCode === 0 ? "done" : "error";
        session.endedAt = new Date().toISOString();
        const msg =
          selectedModelError
            ? `❌ ${selectedModelError}`
            : session.exitCode === 0
            ? "✨ Session closed successfully."
            : `❌ Session ended with error (exit code: ${session.exitCode})`;
        pushEvent("status", msg);
        void persistRecord(true);
        finalizeRun(id, session.status, session.exitCode ?? null, session.endedAt);
        void upsertLocalSessionIndex({
          id,
          startedAt,
          updatedAt: session.endedAt,
          status: session.status,
          preview: (session.output || prompt).slice(0, 160),
          source: "winnow-local",
          cursorSessionId: session.cursorSessionId,
        }, spawnCwd);
        pushStreamEvent(id, "status", {
          status: session.status,
          exitCode: session.exitCode,
          endedAt: session.endedAt,
        });
        pushStreamEvent(id, "done", { sessionId: id });
        closeStreamClients(id);
        sessionWrittenPaths.delete(id);
        evictIdleSessions(sessions);
      })();
    });

    return session;
  };

  const liveScriptWatches = new Map<
    string,
    {
      runId: string;
      processId: string;
      sessionId: string;
      lastOutputAt: number;
      startedAt: number;
      stallMs: number;
      maxRuntimeMs: number;
      autoStopOnStall: boolean;
      warnedStall: boolean;
      timer: ReturnType<typeof setInterval>;
    }
  >();

  const sessionAssistantText = (session: AgentSession): string => {
    const fromEvents = session.events
      .filter((event) => event.kind === "assistant")
      .map((event) => event.content)
      .join("");
    return (fromEvents || session.output || "").trim();
  };

  const appendSessionTimeline = (sessionId: string, kind: AgentEvent["kind"], content: string): void => {
    const session = sessions.get(sessionId);
    if (!session || !content) {
      return;
    }
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
    if (kind === "assistant") {
      session.output += content.endsWith("\n") ? content : `${content}\n`;
      capSessionBuffers(session);
    }
    pushStreamEvent(sessionId, "timeline", { sessionId, event });
    pushStreamEvent(sessionId, "status", { status: session.status, sessionId });
  };

  const ensureTimelineSession = (id: string): AgentSession => {
    const existing = sessions.get(id);
    if (existing) {
      return existing;
    }
    const session: AgentSession = {
      id,
      status: "running",
      startedAt: new Date().toISOString(),
      output: "",
      errorOutput: "",
      command: "script-run",
      args: [],
      events: [],
    };
    sessions.set(id, session);
    return session;
  };

  const finishTimelineSession = (sessionId: string, status: AgentSession["status"]): void => {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.status = status;
    session.endedAt = new Date().toISOString();
    pushStreamEvent(sessionId, "status", { status, sessionId, endedAt: session.endedAt });
    pushStreamEvent(sessionId, "done", { sessionId });
    closeStreamClients(sessionId);
  };

  const clearScriptWatch = (runId: string): void => {
    const watch = liveScriptWatches.get(runId);
    if (watch) {
      clearInterval(watch.timer);
      liveScriptWatches.delete(runId);
    }
  };

  const beginSummarize = async (runId: string): Promise<void> => {
    const run = scriptStore.getRun(runId);
    if (!run) {
      return;
    }
    const script = scriptStore.get(run.scriptId);
    let logTail = "";
    if (run.logPath) {
      try {
        const raw = await readFile(run.logPath, "utf8");
        logTail = raw.slice(-SCRIPT_RUN_DEFAULTS.summarizeLogTailChars);
      } catch {
        logTail = "";
      }
    }
    const prompt = buildSummarizePrompt({
      relPath: script?.relPath || run.scriptId,
      argv: run.actualArgv,
      intent: run.intent,
      exitCode: run.exitCode,
      stopped: run.status === "stopped" || run.status === "stalled",
      stalled: run.stalled,
      logTail,
    });
    try {
      const session = await startAgentSession({
        prompt,
        graphSeed: false,
        sessionId: run.agentSessionId || undefined,
      });
      scriptStore.updateRun(runId, { agentSessionId: session.id });
      const poll = setInterval(() => {
        const live = sessions.get(session.id);
        if (!live || live.status === "running") {
          return;
        }
        clearInterval(poll);
        const summary = sessionAssistantText(live) || "(no summary)";
        scriptStore.updateRun(runId, {
          summaryMd: summary,
        });
      }, 800);
    } catch (error) {
      scriptStore.updateRun(runId, {
        summaryMd: `Summary failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      if (run.agentSessionId) {
        finishTimelineSession(run.agentSessionId, "error");
      }
    }
  };

  const startScriptWatch = (input: {
    runId: string;
    processId: string;
    sessionId: string;
    stallMs: number;
    maxRuntimeMs: number;
    autoStopOnStall: boolean;
  }): void => {
    const watch = {
      ...input,
      lastOutputAt: Date.now(),
      startedAt: Date.now(),
      warnedStall: false,
      timer: setInterval(() => {
        const rec = processManager.get(input.processId);
        const now = Date.now();
        if (!rec || rec.status !== "running") {
          return;
        }
        if (shouldStopForMaxRuntime(watch.startedAt, now, input.maxRuntimeMs)) {
          appendSessionTimeline(input.sessionId, "status", `⚠ max runtime reached — stopping`);
          watch.warnedStall = true;
          scriptStore.updateRun(input.runId, { stalled: true });
          void processManager.stopLadder(input.processId, {
            onStep: (signal) => appendSessionTimeline(input.sessionId, "status", `sent ${signal}`),
          });
          return;
        }
        const last = rec.lastOutputAt ? Date.parse(rec.lastOutputAt) : watch.lastOutputAt;
        if (shouldWarnStall(last, now, input.stallMs) && !watch.warnedStall) {
          watch.warnedStall = true;
          appendSessionTimeline(
            input.sessionId,
            "status",
            `⚠ no output for ${Math.round(input.stallMs / 1000)}s — possible hang or waiting for input`,
          );
          if (input.autoStopOnStall) {
            scriptStore.updateRun(input.runId, { stalled: true });
            void processManager.stopLadder(input.processId, {
              onStep: (signal) => appendSessionTimeline(input.sessionId, "status", `sent ${signal}`),
            });
          }
        }
      }, 2000),
    };
    liveScriptWatches.set(input.runId, watch);
  };

  const server = createServer(async (req, res) => {
    try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`);
    applySecurityHeaders(res, { corsOrigin });

    if (isPublicHealthRequest(url.pathname, req.method)) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      applyNoStore(res);
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(JSON.stringify(UI_HEALTH_PAYLOAD));
      return;
    }

    if (req.method === "OPTIONS" && corsOrigin) {
      res.statusCode = 204;
      res.end();
      return;
    }

    const auth = authorizeAccess(options.token, url, req.headers);
    if (!auth.ok) {
      sendJson(res, 401, { ok: false, error: "unauthorized: invalid or missing token" });
      return;
    }
    if (shouldSetAccessCookie(auth.via) && options.token) {
      res.setHeader("Set-Cookie", buildUiAccessCookie(options.token, isForwardedHttps(req.headers)));
    }

    const previewTarget = resolvePreviewTarget(url, req.headers, options.port, options.token);
    if (previewTarget) {
      proxyPreviewHttp(req, res, previewTarget);
      return;
    }

    if (url.pathname === "/api/preview/probe" && req.method === "GET") {
      const port = Number(url.searchParams.get("port"));
      if (!isValidPreviewPort(port, options.port)) {
        sendJson(res, 400, { ok: false, error: "invalid port" });
        return;
      }
      const result = await probeLoopbackPort(port);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (url.pathname === "/api/preview/chrome" && req.method === "GET") {
      const chromePath = findChromeExecutable();
      sendJson(res, 200, { ok: true, available: Boolean(chromePath), path: chromePath ?? null });
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

    if (url.pathname === "/api/system/live" && req.method === "GET") {
      try {
        const live = await collectSystemLive();
        telemetryStore.add({
          sampledAt: live.sampledAt,
          cpuPercent: live.cpuPercent,
          memUsedPercent: live.memUsedPercent,
          memUsedBytes: live.memUsedBytes,
          batteryPercent: live.batteryPercent,
          batteryCharging: live.batteryCharging,
          thermalState: live.thermalState,
        });
        sendJson(res, 200, { ok: true, ...live });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/system/timeseries" && req.method === "GET") {
      const rawRange = (url.searchParams.get("range") ?? "1h").trim().toLowerCase();
      const range = (["1h", "6h", "24h", "all"].includes(rawRange) ? rawRange : "1h") as "1h" | "6h" | "24h" | "all";
      sendJson(res, 200, { ok: true, samples: telemetryStore.list(range) });
      return;
    }

    if (url.pathname === "/api/system/advisories" && req.method === "GET") {
      const samples = telemetryStore.list("1h");
      sendJson(res, 200, {
        ok: true,
        advisories: buildEfficiencyAdvisories(samples, processManager.list()),
        sampleCount: samples.length,
      });
      return;
    }

    if (url.pathname === "/favicon.ico" && req.method === "GET") {
      res.statusCode = 204;
      res.end();
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
          forceRefresh: url.searchParams.get("refresh") === "1",
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

    if (url.pathname === "/api/plans/inbox" && req.method === "GET") {
      const plans = await listPlans();
      const inbox = plans.slice(0, 12).map((plan) => ({
        plan,
        tasks: planStore.listTasks(plan.id),
      }));
      sendJson(res, 200, { ok: true, inbox });
      return;
    }

    if (url.pathname === "/api/plans" && req.method === "GET") {
      const plans = await listPlans();
      sendJson(res, 200, { ok: true, plans });
      return;
    }

    if (url.pathname === "/api/plans" && req.method === "POST") {
      try {
        const parsedBody = planCreateBodySchema.safeParse(await readJsonBody(req));
        if (!parsedBody.success) {
          sendJson(res, 400, { ok: false, error: parsedBody.error.issues[0]?.message ?? "invalid plan body" });
          return;
        }
        const body = parsedBody.data;
        const plan = planStore.create({
          title: String(body.title || "").trim() || "Untitled plan",
          markdown: body.markdown,
          status: body.status,
        });
        sendJson(res, 200, { ok: true, plan });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname.startsWith("/api/plans/") && url.pathname.endsWith("/tasks") && req.method === "GET") {
      const id = decodeURIComponent(url.pathname.slice("/api/plans/".length, -"/tasks".length)).trim();
      try {
        const tasks = planStore.listTasks(id);
        sendJson(res, 200, { ok: true, planId: id, tasks });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname.startsWith("/api/plans/") && req.method === "GET") {
      const id = decodeURIComponent(url.pathname.slice("/api/plans/".length)).trim();
      const body = await readPlanMarkdown(id);
      sendJson(res, body.ok ? 200 : 400, body);
      return;
    }

    {
      const reconcileMatch = url.pathname.match(/^\/api\/plans\/([^/]+)\/reconcile$/);
      if (reconcileMatch && req.method === "POST") {
        const id = decodeURIComponent(reconcileMatch[1]).trim();
        try {
          const body = (await readJsonBody(req).catch(() => ({}))) as { fix?: boolean };
          const report = reconcilePlan(planStore, id, { fix: Boolean(body && body.fix) });
          sendJson(res, report.ok ? 200 : 400, report);
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
    }

    {
      const syncMatch = url.pathname.match(/^\/api\/plans\/([^/]+)\/github\/sync$/);
      if (syncMatch && req.method === "POST") {
        const id = decodeURIComponent(syncMatch[1]).trim();
        try {
          const body = (await readJsonBody(req)) as {
            taskKeys?: string[];
            repo?: string;
            dryRun?: boolean;
          };
          const result = await syncPlanTasksToGithub(planStore, id, {
            taskKeys: Array.isArray(body.taskKeys) ? body.taskKeys.map(String) : [],
            repo: typeof body.repo === "string" ? body.repo : undefined,
            dryRun: Boolean(body.dryRun),
          });
          sendJson(res, result.ok ? 200 : 400, result);
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
    }

    {
      const ghMatch = url.pathname.match(/^\/api\/plans\/([^/]+)\/tasks\/([^/]+)\/github$/);
      if (ghMatch && req.method === "POST") {
        const id = decodeURIComponent(ghMatch[1]).trim();
        const taskKey = decodeURIComponent(ghMatch[2]).trim();
        try {
          const body = (await readJsonBody(req)) as {
            issueRef?: string | null;
            issueUrl?: string | null;
            issueState?: string | null;
          };
          const mapping = planStore.setTaskMapping(id, taskKey, body);
          sendJson(res, 200, { ok: true, mapping });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
    }

    if (url.pathname.startsWith("/api/plans/") && !url.pathname.endsWith("/normalize") && !url.pathname.endsWith("/tasks") && !/\/tasks\/[^/]+\/github$/.test(url.pathname) && !url.pathname.endsWith("/github/sync") && !url.pathname.endsWith("/reconcile") && req.method === "POST") {
      const id = decodeURIComponent(url.pathname.slice("/api/plans/".length)).trim();
      try {
        const body = (await readJsonBody(req)) as {
          title?: string;
          markdown?: string;
          status?: "draft" | "active" | "blocked" | "done";
        };
        const plan = planStore.save(id, {
          title: body.title,
          markdown: body.markdown,
          status: body.status,
        });
        sendJson(res, 200, { ok: true, plan });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname.startsWith("/api/plans/") && url.pathname.endsWith("/normalize") && req.method === "POST") {
      const id = decodeURIComponent(url.pathname.slice("/api/plans/".length, -"/normalize".length)).trim();
      try {
        const plan = planStore.normalize(id);
        sendJson(res, 200, { ok: true, plan });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/processes" && req.method === "GET") {
      sendJson(res, 200, { ok: true, processes: processManager.list() });
      return;
    }

    if (url.pathname === "/api/processes/start" && req.method === "POST") {
      try {
        const payload = (await readJsonBody(req)) as ManagedProcessStartRequest;
        const started = await processManager.start({
          command: payload.command || "",
          label: payload.label,
          cwd: payload.cwd,
          tags: payload.tags,
        });
        sendJson(res, started.ok ? 200 : 400, started);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname.startsWith("/api/processes/") && url.pathname.endsWith("/stop") && req.method === "POST") {
      const id = decodeURIComponent(url.pathname.slice("/api/processes/".length, -"/stop".length)).trim();
      if (!id) {
        sendJson(res, 400, { ok: false, error: "process id is required" });
        return;
      }
      const body = processManager.stop(id);
      sendJson(res, body.ok ? 200 : 400, body);
      return;
    }

    if (url.pathname.startsWith("/api/processes/") && url.pathname.endsWith("/log") && req.method === "GET") {
      const id = decodeURIComponent(url.pathname.slice("/api/processes/".length, -"/log".length)).trim();
      if (!id) {
        sendJson(res, 400, { ok: false, error: "process id is required" });
        return;
      }
      const tail = Number(url.searchParams.get("tail") ?? "200");
      const body = await processManager.readLog(id, Number.isFinite(tail) ? tail : 200);
      sendJson(res, body.ok ? 200 : 400, body);
      return;
    }

    if (url.pathname === "/api/scripts" && req.method === "GET") {
      try {
        const includeIgnored = url.searchParams.get("ignored") === "1";
        const scripts = scriptStore.list({ includeIgnored }).map((row) => ({
          ...row,
          knobCount: row.knobs.length,
          yamlCount: row.linkedConfigs.length,
        }));
        sendJson(res, 200, { ok: true, scripts });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/scripts/scan" && req.method === "POST") {
      try {
        const index = await rebuildAndWriteScriptIndex(uiWorkspace.dir);
        const scripts = scriptStore.upsertFromScan(index.files).map((row) => ({
          ...row,
          knobCount: row.knobs.length,
          yamlCount: row.linkedConfigs.length,
        }));
        sendJson(res, 200, { ok: true, scannedAt: index.scannedAt, scripts });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/scripts/detail" && req.method === "GET") {
      try {
        const id = String(url.searchParams.get("id") || "").trim();
        const row = scriptStore.get(id);
        if (!row) {
          sendJson(res, 404, { ok: false, error: "script not found" });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          script: { ...row, knobCount: row.knobs.length, yamlCount: row.linkedConfigs.length },
          runs: scriptStore.listRuns(row.id, 8),
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/scripts/flags" && req.method === "POST") {
      try {
        const payload = (await readJsonBody(req)) as { id?: string; pinned?: boolean; ignored?: boolean };
        const row = scriptStore.setFlags(String(payload.id || ""), {
          pinned: payload.pinned,
          ignored: payload.ignored,
        });
        sendJson(res, 200, { ok: true, script: { ...row, knobCount: row.knobs.length } });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/scripts/inspect" && req.method === "POST") {
      try {
        const payload = (await readJsonBody(req)) as { id?: string };
        const row = scriptStore.get(String(payload.id || ""));
        if (!row) {
          sendJson(res, 404, { ok: false, error: "script not found" });
          return;
        }
        const abs = resolveScriptFilePath(uiWorkspace.dir, row.relPath);
        const source = await readFile(abs, "utf8").catch(() => "");
        const session = await startAgentSession({
          prompt: buildInspectPrompt(row.relPath, source, row.knobs),
          graphSeed: false,
        });
        sendJson(res, 200, { ok: true, sessionId: session.id, scriptId: row.id });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/scripts/propose" && req.method === "POST") {
      try {
        const payload = (await readJsonBody(req)) as { id?: string; intent?: string };
        const row = scriptStore.get(String(payload.id || ""));
        if (!row) {
          sendJson(res, 404, { ok: false, error: "script not found" });
          return;
        }
        const runs = scriptStore.listRuns(row.id, 5).map((run) => ({
          intent: run.intent,
          argv: run.actualArgv.length ? run.actualArgv : run.proposedArgv,
          summary: run.summaryMd,
          startedAt: run.startedAt,
        }));
        const session = await startAgentSession({
          prompt: buildProposePrompt({
            relPath: row.relPath,
            blurb: row.blurb,
            knobs: row.knobs,
            intent: String(payload.intent || ""),
            lastRuns: runs,
            sampleCommand: row.sampleCommand,
            linkedConfigs: row.linkedConfigs,
          }),
          graphSeed: false,
        });
        sendJson(res, 200, { ok: true, sessionId: session.id, scriptId: row.id });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/scripts/session-result" && req.method === "GET") {
      try {
        const sessionId = String(url.searchParams.get("sessionId") || "").trim();
        const kind = String(url.searchParams.get("kind") || "propose");
        const scriptId = String(url.searchParams.get("scriptId") || "").trim();
        const session = sessions.get(sessionId);
        if (!session) {
          sendJson(res, 404, { ok: false, error: "session not found" });
          return;
        }
        if (session.status === "running") {
          sendJson(res, 200, { ok: true, ready: false, status: session.status, sessionId });
          return;
        }
        const text = sessionAssistantText(session);
        if (kind === "inspect") {
          const row = scriptStore.get(scriptId);
          if (!row) {
            sendJson(res, 404, { ok: false, error: "script not found" });
            return;
          }
          const incoming = parseInspectedKnobs(text);
          const merged = mergeKnobs(row.knobs, incoming, row.userEditedKnobIds);
          const saved = scriptStore.saveKnobs(row.id, merged, false);
          sendJson(res, 200, { ok: true, ready: true, script: { ...saved, knobCount: saved.knobs.length } });
          return;
        }
        const proposed = parseProposedCommand(text);
        if (scriptId) {
          const row = scriptStore.get(scriptId);
          if (row && proposed.knobs?.length) {
            scriptStore.saveKnobs(row.id, mergeKnobs(row.knobs, proposed.knobs, row.userEditedKnobIds), false);
          }
        }
        sendJson(res, 200, {
          ok: true,
          ready: true,
          proposed,
          preview: formatCommandPreview(proposed.argv),
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/scripts/run" && req.method === "POST") {
      try {
        const payload = (await readJsonBody(req)) as {
          id?: string;
          intent?: string;
          argv?: string[];
          cwd?: string;
          env?: Record<string, string>;
          notes?: string;
        };
        const row = scriptStore.get(String(payload.id || ""));
        if (!row) {
          sendJson(res, 404, { ok: false, error: "script not found" });
          return;
        }
        const spawnPlan = buildSpawnArgv(uiWorkspace.dir, {
          argv: Array.isArray(payload.argv) ? payload.argv.map(String) : [],
          cwd: payload.cwd || ".",
          env: payload.env || {},
          notes: payload.notes || "",
        });
        const run = scriptStore.createRun({
          scriptId: row.id,
          intent: String(payload.intent || ""),
          knobs: row.knobs,
          proposedArgv: [spawnPlan.file, ...spawnPlan.args],
          actualArgv: [spawnPlan.file, ...spawnPlan.args],
          env: spawnPlan.env,
          cwd: spawnPlan.cwd,
        });
        const timelineId = `script-${run.id}`;
        ensureTimelineSession(timelineId);
        appendSessionTimeline(timelineId, "status", `Starting ${spawnPlan.preview}`);
        const started = await processManager.startArgv({
          file: spawnPlan.file,
          args: spawnPlan.args,
          cwd: spawnPlan.cwd,
          env: spawnPlan.env,
          label: row.title,
          tags: [`script:${row.id}`],
          onOutput: (chunk, stream) => {
            const line = chunk.trim();
            if (!line) {
              return;
            }
            const clipped = line.length > 400 ? `${line.slice(0, 400)}…` : line;
            appendSessionTimeline(timelineId, stream === "stderr" ? "stderr" : "status", clipped);
            const watch = liveScriptWatches.get(run.id);
            if (watch) {
              watch.lastOutputAt = Date.now();
              watch.warnedStall = false;
            }
          },
          onClose: (code, signal) => {
            clearScriptWatch(run.id);
            const stalled = Boolean(scriptStore.getRun(run.id)?.stalled);
            const stopped = Boolean(signal) || stalled;
            const status = stalled ? "stalled" : stopped ? "stopped" : code === 0 ? "done" : "error";
            scriptStore.updateRun(run.id, {
              status,
              exitCode: code,
              endedAt: new Date().toISOString(),
            });
            appendSessionTimeline(
              timelineId,
              "status",
              stalled
                ? `Run stalled and stopped (exit=${code ?? "n/a"} signal=${signal || "none"})`
                : `Script exited code=${code ?? "n/a"} signal=${signal || "none"}`,
            );
            void beginSummarize(run.id);
          },
        });
        if (!started.ok) {
          scriptStore.updateRun(run.id, { status: "error", summaryMd: started.error, endedAt: new Date().toISOString() });
          sendJson(res, 400, started);
          return;
        }
        scriptStore.updateRun(run.id, {
          status: "running",
          processId: started.process.id,
          agentSessionId: timelineId,
          logPath: started.process.logPath,
          actualArgv: [spawnPlan.file, ...spawnPlan.args],
        });
        scriptStore.rememberRecipe(row.id, [spawnPlan.file, ...spawnPlan.args], spawnPlan.env);
        startScriptWatch({
          runId: run.id,
          processId: started.process.id,
          sessionId: timelineId,
          stallMs: row.stallMs ?? SCRIPT_RUN_DEFAULTS.stallMs,
          maxRuntimeMs: row.maxRuntimeMs ?? SCRIPT_RUN_DEFAULTS.maxRuntimeMs,
          autoStopOnStall: row.autoStopOnStall,
        });
        sendJson(res, 200, {
          ok: true,
          run: scriptStore.getRun(run.id),
          sessionId: timelineId,
          preview: spawnPlan.preview,
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname.startsWith("/api/scripts/runs/") && url.pathname.endsWith("/stop") && req.method === "POST") {
      const runId = decodeURIComponent(url.pathname.slice("/api/scripts/runs/".length, -"/stop".length)).trim();
      const run = scriptStore.getRun(runId);
      if (!run) {
        sendJson(res, 404, { ok: false, error: "run not found" });
        return;
      }
      if (!run.processId) {
        sendJson(res, 200, { ok: true, stopped: false, message: "no process" });
        return;
      }
      const sessionId = run.agentSessionId;
      const result = await processManager.stopLadder(run.processId, {
        onStep: (signal) => {
          if (sessionId) {
            appendSessionTimeline(sessionId, "status", `sent ${signal}`);
          }
        },
      });
      sendJson(res, result.ok ? 200 : 400, result);
      return;
    }

    if (url.pathname === "/api/graph/rebuild" && req.method === "POST") {
      try {
        const result = await graphService.rebuild(uiWorkspace.dir);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/graph/summary" && req.method === "GET") {
      try {
        const summary = graphService.summary(uiWorkspace.dir);
        sendJson(res, 200, { ok: true, summary });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/graph/nodes" && req.method === "GET") {
      try {
        const limit = Number(url.searchParams.get("limit") ?? "500");
        const nodes = graphService.listNodes(uiWorkspace.dir, {
          kind: url.searchParams.get("kind") ?? undefined,
          detailLevel: url.searchParams.get("detailLevel") ?? undefined,
          limit: Number.isFinite(limit) ? limit : 500,
        });
        sendJson(res, 200, { ok: true, nodes });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/graph/edges" && req.method === "GET") {
      try {
        const limit = Number(url.searchParams.get("limit") ?? "1000");
        const edges = graphService.listEdges(uiWorkspace.dir, {
          kind: url.searchParams.get("kind") ?? undefined,
          fromId: url.searchParams.get("fromId") ?? undefined,
          toId: url.searchParams.get("toId") ?? undefined,
          limit: Number.isFinite(limit) ? limit : 1000,
        });
        sendJson(res, 200, { ok: true, edges });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname.startsWith("/api/graph/node/") && url.pathname.endsWith("/neighbors") && req.method === "GET") {
      try {
        const nodeId = decodeURIComponent(
          url.pathname.slice("/api/graph/node/".length, -"/neighbors".length),
        ).trim();
        if (!nodeId) {
          sendJson(res, 400, { ok: false, error: "node id is required" });
          return;
        }
        const neighborhood = graphService.neighbors(uiWorkspace.dir, nodeId);
        sendJson(res, 200, { ok: true, ...neighborhood });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/graph/corrections" && req.method === "POST") {
      try {
        const parsed = graphCorrectionsBodySchema.safeParse(await readJsonBody(req));
        if (!parsed.success) {
          sendJson(res, 400, { ok: false, error: parsed.error.issues[0]?.message ?? "invalid corrections" });
          return;
        }
        const result = graphService.applyCorrections(uiWorkspace.dir, parsed.data.operations);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/graph/reconcile" && req.method === "POST") {
      try {
        const report = graphService.reconcile(uiWorkspace.dir, "manual_reconcile");
        sendJson(res, 200, { ok: true, report });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/graph/recaps" && req.method === "GET") {
      try {
        const limit = Number(url.searchParams.get("limit") ?? "20");
        const recaps = graphService.latestRecaps(uiWorkspace.dir, Number.isFinite(limit) ? limit : 20);
        sendJson(res, 200, { ok: true, recaps });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/graph/business-logic" && req.method === "GET") {
      try {
        const rawLayer = (url.searchParams.get("layer") ?? "full").trim().toLowerCase();
        const layer = rawLayer === "goal" ? "goal" : "full";
        const graph = graphService.businessLogicGraph(uiWorkspace.dir, layer);
        sendJson(res, 200, { ok: true, graph });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
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

    if (url.pathname === "/api/pricing" && req.method === "GET") {
      const rates = getDefaultUsdPerMillion();
      sendJson(res, 200, {
        ok: true,
        inputUsdPerMillion: rates.inPerMillion,
        outputUsdPerMillion: rates.outPerMillion,
        path: pricingOverridePath(),
      });
      return;
    }

    if (url.pathname === "/api/pricing" && req.method === "POST") {
      try {
        const body = (await readJsonBody(req)) as {
          inputUsdPerMillion?: unknown;
          outputUsdPerMillion?: unknown;
        };
        const inputUsdPerMillion = Number(body.inputUsdPerMillion);
        const outputUsdPerMillion = Number(body.outputUsdPerMillion);
        const rates = setDefaultUsdPerMillion(inputUsdPerMillion, outputUsdPerMillion);
        const recomputed = recomputeAllRunCosts();
        sendJson(res, 200, {
          ok: true,
          message: `Saved default rates and recalculated cost on ${recomputed.updated} run(s).`,
          inputUsdPerMillion: rates.inPerMillion,
          outputUsdPerMillion: rates.outPerMillion,
          recomputed: recomputed.updated,
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (url.pathname === "/api/workspace/cwd" && req.method === "POST") {
      try {
        const payload = (await readJsonBody(req)) as { path?: string; reset?: boolean };
        const previousDir = uiWorkspace.dir;
        if (payload.reset) {
          const next = await applyWorkspaceDir(winnowLaunchRoot, true);
          await registerProject(next);
          void rebuildAndWriteProjectDocsIndex(next).catch(() => {});
          notifyRunningAgentsOfCwdChange(previousDir, next);
          sendJson(res, 200, {
            ok: true,
            cwd: next,
            transcriptDir: cursorTranscriptDirForUi(),
            launchRoot: winnowLaunchRoot,
            runningCount: countRunningSessions(sessions.values()),
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
        notifyRunningAgentsOfCwdChange(previousDir, next);
        sendJson(res, 200, {
          ok: true,
          cwd: next,
          transcriptDir: cursorTranscriptDirForUi(),
          launchRoot: winnowLaunchRoot,
          runningCount: countRunningSessions(sessions.values()),
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
          const stream = createReadStream(abs);
          stream.on("error", (error) => {
            sendHandlerError(res, error);
          });
          stream.pipe(res);
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

    if (url.pathname === "/api/fs/open" && req.method === "POST") {
      try {
        const payload = (await readJsonBody(req)) as { path: string };
        const raw = payload.path?.trim();
        if (!raw) {
          sendJson(res, 400, { ok: false, error: "path is required" });
          return;
        }
        const target = resolveUiPath(raw);
        // On macOS, 'open' uses the default application.
        // We'll also try 'cursor' command if it might be in PATH,
        // but 'open' is a safer generic default for a companion UI.
        spawn("open", [target], { stdio: "ignore", detached: true }).unref();
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/providers/status" && req.method === "GET") {
      try {
        const providers = await listProviderStatus();
        sendJson(res, 200, { ok: true, providers });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/providers/smoke" && req.method === "POST") {
      try {
        const payload = (await readJsonBody(req)) as {
          provider?: ExternalProvider;
          apiKey?: string;
          persist?: boolean;
          baseUrl?: string;
          model?: string;
        };
        const provider = payload.provider;
        if (!provider || !PROVIDERS.some((p) => p.id === provider)) {
          sendJson(res, 400, { ok: false, error: "provider is required" });
          return;
        }
        const definition = getProviderDefinition(provider);
        const envFile = readDotenvFile(winnowLaunchRoot);
        const incoming = String(payload.apiKey ?? "").trim();
        const effectiveKey = incoming || String(process.env[definition.envKey] ?? envFile[definition.envKey] ?? "").trim();
        const baseUrl = String(payload.baseUrl ?? "").trim();
        const model = String(payload.model ?? "").trim();
        if (!effectiveKey) {
          sendJson(res, 400, { ok: false, error: `Missing API key for ${provider}` });
          return;
        }
        if (provider === "universal" && !baseUrl) {
          sendJson(res, 400, { ok: false, error: "Universal adapter base URL is required" });
          return;
        }
        if (provider === "universal" && !model) {
          sendJson(res, 400, { ok: false, error: "Universal adapter model is required" });
          return;
        }
        if (payload.persist && incoming) {
          const merged = { ...envFile, [definition.envKey]: incoming };
          writeDotenvFileFull(winnowLaunchRoot, merged);
          loadDotenvFromDisk(winnowLaunchRoot, { override: true });
        }
        const smoke = await smokeTestProvider(provider, effectiveKey, {
          deepseekBaseUrl: config.deepseekBaseUrl,
          baseUrl,
          model,
        });
        if (!smoke.ok) {
          sendJson(res, 200, smoke);
          return;
        }
        const models = provider === "universal" ? [model] : definition.defaultModels;
        await upsertProviderVerification(provider, models, { baseUrl });
        sendJson(res, 200, { ...smoke, models, baseUrl });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/cursor/bootstrap" && req.method === "GET") {
      try {
        const account = await bootstrapCursorCli();
        sendJson(res, 200, { ok: true, ...account });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/cursor/subagents" && req.method === "GET") {
      const defined = listSubagentDefinitionFiles(uiWorkspace.dir, homedir());
      sendJson(res, 200, {
        ok: true,
        agents: withBuiltinSubagents(defined),
        hint: SUBAGENTS_HINT,
      });
      return;
    }

    if (url.pathname === "/api/cursor/account" && req.method === "GET") {
      try {
        const account = await readCursorAccount();
        if (account.loggedIn) {
          stopCursorLogin();
        }
        sendJson(res, 200, { ok: true, ...account });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/cursor/login" && req.method === "POST") {
      try {
        const current = await readCursorAccount();
        if (current.loggedIn) {
          stopCursorLogin();
          sendJson(res, 200, { ok: true, alreadyLoggedIn: true, ...current, loginUrl: "" });
          return;
        }
        const started = startCursorLogin();
        await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
        const loginUrl = extractLoginUrl(cursorLoginOutput) || started.loginUrl;
        sendJson(res, 200, {
          ok: true,
          alreadyLoggedIn: false,
          started: started.started,
          alreadyRunning: started.alreadyRunning,
          loginUrl,
          output: cursorLoginOutput.slice(-2000),
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/models/selectable" && req.method === "GET") {
      try {
        const options = await listSelectableModels();
        const account = await readCursorAccount();
        sendJson(res, 200, {
          ok: true,
          models: options.map((item) => item.id),
          options,
          loggedIn: account.loggedIn,
          warning: account.loggedIn
            ? (options.length ? "" : "Cursor CLI returned no models for this account.")
            : "Log in to Cursor Agent to load the model list.",
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: (error as Error).message });
      }
      return;
    }

    if (url.pathname === "/api/models/external-selectable" && req.method === "GET") {
      try {
        const models = await listExternalSelectableModels();
        sendJson(res, 200, { ok: true, models });
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
        for (const live of listRunningSessions(sessions.values())) {
          const existingRow = byId.get(live.id);
          const projectRoot = live.projectRoot || uiWorkspace.dir;
          if (existingRow) {
            byId.set(live.id, {
              ...existingRow,
              status: "running",
              startedAt: live.startedAt,
              projectRoot,
              cursorSessionId: live.cursorSessionId || existingRow.cursorSessionId,
            });
            continue;
          }
          byId.set(live.id, {
            id: live.id,
            file: localSessionRecordPath(live.id, projectRoot),
            updatedAt: live.startedAt,
            preview: firstUserPreview(live),
            cursorSessionId: live.cursorSessionId,
            status: "running",
            startedAt: live.startedAt,
            source: "winnow-local",
            projectRoot,
          });
        }
        const merged = [...byId.values()]
          .sort((a, b) => {
            const ar = a.status === "running" ? 1 : 0;
            const br = b.status === "running" ? 1 : 0;
            if (ar !== br) {
              return br - ar;
            }
            return a.updatedAt < b.updatedAt ? 1 : -1;
          })
          .slice(0, max)
          .map((s) => {
            const live = sessions.get(s.id);
            const withCursor =
              s.cursorSessionId || !isCursorChatSessionId(s.id) ? s : { ...s, cursorSessionId: s.id };
            return {
              ...withCursor,
              status: live?.status ?? s.status,
              startedAt: live?.startedAt ?? s.startedAt,
              projectRoot: live?.projectRoot ?? s.projectRoot,
            };
          });
        sendJson(res, 200, {
          sessions: merged,
          dir: transcriptDirLabel,
          localDir: localSessionDir(),
          cwd: uiWorkspace.dir,
          runningCount: countRunningSessions(sessions.values()),
          maxConcurrent: MAX_CONCURRENT_AGENT_RUNS,
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
        let session: { id: string; messages: SessionMessage[]; cursorSessionId?: string } | undefined;
        try {
          session = await readLocalSession(id);
        } catch {
          const live = sessions.get(id);
          if (live?.projectRoot && live.projectRoot !== uiWorkspace.dir) {
            try {
              session = await readLocalSession(id, live.projectRoot);
            } catch {
              session = undefined;
            }
          }
          if (!session && live) {
            session = {
              id,
              messages: (live.events ?? []).map((event) => ({
                id: event.id,
                role: event.kind,
                content: event.content,
                timestamp: event.ts,
              })),
              cursorSessionId: live.cursorSessionId,
            };
          }
        }
        if (!session) {
          if (explicitDir) {
            session = await readCursorSession(id, explicitDir);
          } else if (envTranscripts) {
            session = await readCursorSession(id);
          } else {
            session = await readCursorSession(id, undefined, uiWorkspace.dir);
          }
        }
        sendJson(res, 200, {
          ...session,
          cursorSessionId: session.cursorSessionId || (isCursorChatSessionId(id) ? id : undefined),
        });
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

    if (url.pathname === "/api/attachments" && req.method === "POST") {
      try {
        const body = (await readJsonBody(req)) as { mime?: string; dataBase64?: string };
        const saved = await saveAttachment(uiWorkspace.dir, {
          mime: String(body.mime ?? ""),
          dataBase64: String(body.dataBase64 ?? ""),
        });
        sendJson(res, 200, { ok: true, id: saved.id, relPath: saved.relPath, absPath: saved.absPath });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
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
        const parsedStart = agentStartRequestSchema.safeParse(await readJsonBody(req));
        if (!parsedStart.success) {
          sendJson(res, 400, { ok: false, error: parsedStart.error.issues[0]?.message ?? "prompt is required" });
          return;
        }
        const payload = parsedStart.data as AgentStartRequest;
        const session = await startAgentSession(payload, { signal: abortFromDisconnect.signal });
        sendJson(res, 200, { ok: true, sessionId: session.id, cursorSessionId: session.cursorSessionId || null });
      } catch (error) {
        if (error instanceof AgentStartBlockedError) {
          if (!res.headersSent) {
            sendJson(res, error.status, { ok: false, error: error.message, code: error.code });
          }
          return;
        }
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

    if (url.pathname === "/api/agent/slash-catalog" && req.method === "GET") {
      sendJson(res, 200, { ok: true, items: listSlashCatalog(uiWorkspace.dir, homedir()) });
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

    if (url.pathname === "/api/agent/active" && req.method === "GET") {
      const picked = pickActiveAgentSession(sessions.values());
      if (!picked) {
        sendJson(res, 200, { ok: true, session: null, runningCount: 0, maxConcurrent: MAX_CONCURRENT_AGENT_RUNS });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        session: toSessionClientDto(picked),
        runningCount: countRunningSessions(sessions.values()),
        maxConcurrent: MAX_CONCURRENT_AGENT_RUNS,
      });
      return;
    }

    if (url.pathname === "/api/agent/running" && req.method === "GET") {
      const running = listRunningSessions(sessions.values()).map((session) => ({
        ...toSessionClientDto(session, 20),
        preview: firstUserPreview(session),
        writtenPaths: [...(sessionWrittenPaths.get(session.id) ?? [])].sort(),
        projectRoot: session.projectRoot || uiWorkspace.dir,
      }));
      sendJson(res, 200, {
        ok: true,
        sessions: running,
        runningCount: running.length,
        maxConcurrent: MAX_CONCURRENT_AGENT_RUNS,
        cwd: uiWorkspace.dir,
      });
      return;
    }

    if (url.pathname === "/api/agent/overlaps" && req.method === "GET") {
      try {
        const payload = await runningOverlapPayload();
        sendJson(res, 200, { ok: true, ...payload });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
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
      const dto = toSessionClientDto(session);
      sendJson(res, 200, {
        ok: true,
        session: {
          ...dto,
          output: dto.outputTail,
          errorOutput: dto.errorOutputTail,
        },
      });
      return;
    }

    if (url.pathname === "/main" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      applyNoStore(res);
      res.end(buildMainTerminalHtml(options.token, paneCommands));
      return;
    }

    if (url.pathname === "/agent" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      applyNoStore(res);
      res.end(buildAgentWindowPageHtml(options.token));
      return;
    }

    if (url.pathname === "/" && req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      applyNoStore(res);
      res.end(buildDashboardPageHtml(options.token));
      return;
    }

    res.statusCode = 404;
    res.end("Not found");
    } catch (error) {
      sendHandlerError(res, error);
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${options.port}`);
    if (!authorizeAccess(options.token, url, req.headers).ok) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    if (url.pathname.startsWith("/ws/main/")) {
      mainPaneWs.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        mainPaneWs.emit("connection", ws, req);
      });
      return;
    }
    if (url.pathname === "/ws/preview/chrome") {
      chromePreviewWs.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        chromePreviewWs.emit("connection", ws, req);
      });
      return;
    }
    const previewTarget = resolvePreviewTarget(url, req.headers, options.port, options.token);
    if (previewTarget) {
      proxyPreviewWebSocket(req, socket, head, previewTarget);
      return;
    }
    socket.destroy();
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
  if (options.remote) {
    process.stdout.write("[winnow-ui] remote mode: bound for network access; browser not auto-opened\n");
  }
  if (!options.token && (options.remote || options.host === "0.0.0.0")) {
    process.stdout.write(
      "[winnow-ui] warning: no access token (--no-token); anyone who can reach this bind can use the UI\n",
    );
  }
  if (options.remote || options.host === "0.0.0.0") {
    process.stdout.write(
      "[winnow-ui] reverse proxy must forward WebSocket Upgrade for /ws/main/*, /ws/preview/chrome, SSE for /api/agent/:id/stream, and /__preview/*\n",
    );
  }
  process.stdout.write("[winnow-ui] press Ctrl+C to stop\n");
  const launchUrl = options.host === "0.0.0.0" ? localUrl : boundUrl;
  if (options.desktopShell) {
    process.stdout.write("[winnow-ui] opening embedded Electron window (--shell)\n");
    spawnDesktopShell(launchUrl);
  } else if (options.openBrowser) {
    maybeOpenBrowser(launchUrl);
  }
}
