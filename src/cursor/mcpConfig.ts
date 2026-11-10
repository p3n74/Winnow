import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type McpConfigSource = "project" | "global";

export type McpTransportHint = "stdio" | "http" | "sse" | "unknown";

export type ConfiguredMcpServer = {
  name: string;
  source: McpConfigSource;
  transportHint: McpTransportHint;
};

export type McpConfigStatus = {
  projectPath: string;
  globalPath: string;
  projectExists: boolean;
  globalExists: boolean;
  servers: ConfiguredMcpServer[];
  errors: string[];
};

type RawMcpServer = {
  type?: unknown;
  command?: unknown;
  url?: unknown;
  args?: unknown;
  env?: unknown;
};

function globalMcpConfigPath(home = homedir()): string {
  return join(home, ".cursor", "mcp.json");
}

function projectMcpConfigPath(workspaceDir: string): string {
  return join(workspaceDir, ".cursor", "mcp.json");
}

function inferTransport(entry: RawMcpServer): McpTransportHint {
  const explicit =
    typeof entry.type === "string" ? entry.type.trim().toLowerCase() : "";
  if (explicit === "stdio" || explicit === "http" || explicit === "sse") {
    return explicit;
  }
  if (typeof entry.command === "string" && entry.command.trim()) {
    return "stdio";
  }
  if (typeof entry.url === "string" && entry.url.trim()) {
    const url = entry.url.trim().toLowerCase();
    if (url.includes("/sse") || url.endsWith("sse")) {
      return "sse";
    }
    return "http";
  }
  return "unknown";
}

function readMcpServersFile(
  path: string,
  source: McpConfigSource,
): { servers: ConfiguredMcpServer[]; error?: string } {
  if (!existsSync(path)) {
    return { servers: [] };
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return {
      servers: [],
      error: `failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return {
      servers: [],
      error: `invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { servers: [], error: `invalid mcp.json shape in ${path}: expected object` };
  }
  const mcpServers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (mcpServers == null) {
    return { servers: [] };
  }
  if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    return { servers: [], error: `invalid mcpServers in ${path}: expected object` };
  }
  const servers: ConfiguredMcpServer[] = [];
  for (const [name, value] of Object.entries(mcpServers as Record<string, unknown>)) {
    const trimmed = name.trim();
    if (!trimmed) {
      continue;
    }
    const entry =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as RawMcpServer)
        : {};
    servers.push({
      name: trimmed,
      source,
      transportHint: inferTransport(entry),
    });
  }
  return { servers };
}

/**
 * Read Cursor-compatible MCP config files without spawning cursor-agent.
 * Project config wins for duplicate names when listing (project entry kept first).
 */
export function listConfiguredMcpServers(
  workspaceDir: string,
  options?: { homeDir?: string },
): McpConfigStatus {
  const home = options?.homeDir ?? homedir();
  const projectPath = projectMcpConfigPath(workspaceDir);
  const globalPath = globalMcpConfigPath(home);
  const projectExists = existsSync(projectPath);
  const globalExists = existsSync(globalPath);
  const errors: string[] = [];

  const project = readMcpServersFile(projectPath, "project");
  if (project.error) {
    errors.push(project.error);
  }
  const global = readMcpServersFile(globalPath, "global");
  if (global.error) {
    errors.push(global.error);
  }

  const seen = new Set<string>();
  const servers: ConfiguredMcpServer[] = [];
  for (const server of [...project.servers, ...global.servers]) {
    const key = server.name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    servers.push(server);
  }

  return {
    projectPath,
    globalPath,
    projectExists,
    globalExists,
    servers,
    errors,
  };
}

export function formatMcpDoctorLine(status: McpConfigStatus): string {
  if (status.errors.length > 0 && status.servers.length === 0) {
    return `mcp: FAIL — ${status.errors[0]}`;
  }
  if (status.servers.length === 0) {
    return "mcp: none configured (edit .cursor/mcp.json or ~/.cursor/mcp.json; see docs/mcp.md)";
  }
  const projectCount = status.servers.filter((s) => s.source === "project").length;
  const globalCount = status.servers.filter((s) => s.source === "global").length;
  const names = status.servers.map((s) => s.name).join(", ");
  const warn = status.errors.length > 0 ? ` — warnings: ${status.errors.length}` : "";
  return `mcp: OK — ${projectCount} project, ${globalCount} global (${names})${warn}`;
}
