export type UiOptions = {
  port: number;
  openBrowser: boolean;
  /** When true, open the UI in an embedded Electron window instead of the system browser. */
  desktopShell?: boolean;
  host: string;
  token?: string;
  paneCommands?: Record<"1" | "2" | "3" | "4" | "5", string>;
};

export type PaneId = "1" | "2" | "3" | "4" | "5";

export const DEFAULT_PANE_COMMANDS: Record<PaneId, string> = {
  "1": "ranger",
  /** Pane 2 is the embed workspace (iframe); the shell PTY is opened only from the Workspace↔Terminal tab in that pane. */
  "2": "",
  "3": "htop",
  "4": "netwatch",
  "5": process.platform === "win32" ? "" : process.env.SHELL || "zsh",
};

export type ProfileUpdateRequest = {
  backend?: "ollama" | "deepseek_api";
  model?: string;
  glossary?: string;
  mode?: "zh" | "raw" | "dual";
};

export type AgentStartRequest = {
  prompt: string;
  args?: string;
  modelPreference?: string;
  autonomyMode?: boolean;
  /** When true (default), prepend a Winnow graph-derived scope hint to the agent prompt. */
  graphSeed?: boolean;
  planId?: string;
  sessionId?: string;
  executionMode?: "cursor" | "external";
};

export type AgentEvent = {
  id: string;
  ts: string;
  kind: "user" | "assistant" | "stderr" | "status" | "tool" | "system";
  content: string;
};

export type AgentSession = {
  id: string;
  status: "running" | "done" | "error";
  startedAt: string;
  endedAt?: string;
  output: string;
  errorOutput: string;
  exitCode?: number;
  error?: string;
  command: string;
  args: string[];
  events: AgentEvent[];
};

export type SessionStreamClient = {
  res: import("node:http").ServerResponse;
};

export type StageFilesRequest = {
  files: string[];
};

export type ManagedProcessStartRequest = {
  command?: string;
  label?: string;
  cwd?: string;
  tags?: string[];
};

export type FileListEntry = {
  name: string;
  path: string;
  type: "dir" | "file";
};

export type SessionMessage = {
  id?: string;
  role: string;
  content: string;
  timestamp?: string;
};

export type LocalSessionIndexEntry = {
  id: string;
  updatedAt: string;
  startedAt: string;
  status: "running" | "done" | "error";
  preview: string;
  source: "winnow-local";
};

export type LocalSessionRecord = {
  id: string;
  projectRoot: string;
  startedAt: string;
  endedAt?: string;
  status: "running" | "done" | "error";
  args: string[];
  modelPreference: string;
  prompt: string;
  output: string;
  errorOutput: string;
  events?: AgentEvent[];
};
