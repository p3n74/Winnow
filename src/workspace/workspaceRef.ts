export type LocalWorkspaceRef = {
  kind: "local";
  path: string;
};

export type SshWorkspaceRef = {
  kind: "ssh";
  host: string;
  remotePath: string;
  user?: string;
  port?: number;
  identityFile?: string;
};

export type WorkspaceRef = LocalWorkspaceRef | SshWorkspaceRef;

export type WorkspaceCapabilities = {
  git: boolean;
  agent: boolean;
  pty: boolean;
  graph: boolean;
  docs: boolean;
  processes: boolean;
  preview: boolean;
  fs: boolean;
  plans: boolean;
};

export const LOCAL_WORKSPACE_CAPABILITIES: WorkspaceCapabilities = {
  git: true,
  agent: true,
  pty: true,
  graph: true,
  docs: true,
  processes: true,
  preview: true,
  fs: true,
  plans: true,
};

export const SSH_WORKSPACE_CAPABILITIES: WorkspaceCapabilities = {
  git: true,
  agent: true,
  pty: true,
  graph: false,
  docs: false,
  processes: false,
  preview: false,
  fs: false,
  plans: false,
};

export const SSH_GATED_FEATURE_ERROR =
  "This control is not available on SSH workspaces yet. Agent, git, and terminals run on the remote host.";

const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/;
const SCP_LIKE_RE = /^(?:([\w.-]+)@)?([\w.-]+):((?:\/|~\/).+)$/;

export function workspaceCapabilities(kind: WorkspaceRef["kind"]): WorkspaceCapabilities {
  return kind === "ssh" ? SSH_WORKSPACE_CAPABILITIES : LOCAL_WORKSPACE_CAPABILITIES;
}

export function looksLikeSshWorkspace(raw: string): boolean {
  const t = raw.trim();
  if (!t) {
    return false;
  }
  if (t.startsWith("ssh://") || t.startsWith("SSH://")) {
    return true;
  }
  if (WINDOWS_DRIVE_RE.test(t) || t.startsWith("\\\\")) {
    return false;
  }
  return SCP_LIKE_RE.test(t);
}

export function parseWorkspaceInput(raw: string): WorkspaceRef {
  const t = raw.trim();
  if (!t) {
    throw new Error("workspace path is required");
  }
  if (t.startsWith("ssh://") || t.startsWith("SSH://")) {
    return parseSshUrl(t);
  }
  if (looksLikeSshWorkspace(t)) {
    return parseScpLike(t);
  }
  return { kind: "local", path: t };
}

export function formatWorkspaceRef(ref: WorkspaceRef): string {
  if (ref.kind === "local") {
    return ref.path;
  }
  const auth = ref.user ? `${encodeURIComponent(ref.user)}@` : "";
  const port = ref.port ? `:${ref.port}` : "";
  const path = ref.remotePath.startsWith("/") ? ref.remotePath : `/${ref.remotePath}`;
  const url = new URL(`ssh://${auth}${ref.host}${port}${path}`);
  if (ref.identityFile) {
    url.searchParams.set("identityFile", ref.identityFile);
  }
  return url.toString();
}

export function sshDestination(ref: SshWorkspaceRef): string {
  return ref.user ? `${ref.user}@${ref.host}` : ref.host;
}

export function workspaceDisplayName(ref: WorkspaceRef): string {
  if (ref.kind === "local") {
    const parts = ref.path.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts[parts.length - 1] || ref.path;
  }
  const base = ref.remotePath.replace(/\/+$/, "").split("/").filter(Boolean).pop() || ref.remotePath;
  return `${base} (${sshDestination(ref)})`;
}

function parseSshUrl(raw: string): SshWorkspaceRef {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid SSH workspace URL: ${raw}`);
  }
  if (url.protocol !== "ssh:") {
    throw new Error(`Invalid SSH workspace URL: ${raw}`);
  }
  const host = url.hostname.trim();
  if (!host) {
    throw new Error("SSH workspace URL needs a host");
  }
  const remotePath = decodeURIComponent(url.pathname || "");
  if (!remotePath || remotePath === "/") {
    throw new Error("SSH workspace URL needs a remote directory path (ssh://user@host/abs/path)");
  }
  const identityFile = url.searchParams.get("identityFile")?.trim() || undefined;
  const port = url.port ? Number(url.port) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error(`Invalid SSH port: ${url.port}`);
  }
  const user = url.username ? decodeURIComponent(url.username) : undefined;
  return {
    kind: "ssh",
    host,
    remotePath: remotePath.startsWith("/~/") ? `~/${remotePath.slice(3)}` : remotePath,
    user: user || undefined,
    port,
    identityFile,
  };
}

function parseScpLike(raw: string): SshWorkspaceRef {
  const match = SCP_LIKE_RE.exec(raw.trim());
  if (!match) {
    throw new Error(`Invalid SSH workspace: ${raw}`);
  }
  const user = match[1] || undefined;
  const host = match[2];
  const remotePath = match[3];
  return { kind: "ssh", host, remotePath, user };
}
