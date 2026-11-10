import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatMcpDoctorLine,
  listConfiguredMcpServers,
} from "../src/cursor/mcpConfig.js";

function tempWorkspace(): { root: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), "winnow-mcp-"));
  const home = mkdtempSync(join(tmpdir(), "winnow-mcp-home-"));
  return { root, home };
}

describe("listConfiguredMcpServers", () => {
  it("returns empty when no mcp.json exists", () => {
    const { root, home } = tempWorkspace();
    const status = listConfiguredMcpServers(root, { homeDir: home });
    expect(status.projectExists).toBe(false);
    expect(status.globalExists).toBe(false);
    expect(status.servers).toEqual([]);
    expect(status.errors).toEqual([]);
    expect(formatMcpDoctorLine(status)).toContain("none configured");
  });

  it("reads project and global servers and prefers project on name clash", () => {
    const { root, home } = tempWorkspace();
    mkdirSync(join(root, ".cursor"), { recursive: true });
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(root, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          shared: { command: "npx", args: ["-y", "proj"] },
          playwright: { command: "npx", args: ["-y", "@playwright/mcp"] },
        },
      }),
    );
    writeFileSync(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          shared: { url: "https://example.com/mcp" },
          gmail: { type: "sse", url: "https://example.com/sse" },
        },
      }),
    );

    const status = listConfiguredMcpServers(root, { homeDir: home });
    expect(status.projectExists).toBe(true);
    expect(status.globalExists).toBe(true);
    expect(status.servers).toEqual([
      { name: "shared", source: "project", transportHint: "stdio" },
      { name: "playwright", source: "project", transportHint: "stdio" },
      { name: "gmail", source: "global", transportHint: "sse" },
    ]);
    expect(formatMcpDoctorLine(status)).toMatch(/^mcp: OK — 2 project, 1 global/);
  });

  it("records invalid JSON without throwing", () => {
    const { root, home } = tempWorkspace();
    mkdirSync(join(root, ".cursor"), { recursive: true });
    writeFileSync(join(root, ".cursor", "mcp.json"), "{ not json");
    const status = listConfiguredMcpServers(root, { homeDir: home });
    expect(status.servers).toEqual([]);
    expect(status.errors[0]).toMatch(/invalid JSON/);
    expect(formatMcpDoctorLine(status)).toMatch(/^mcp: FAIL/);
  });
});
