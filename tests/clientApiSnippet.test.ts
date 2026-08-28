import { describe, expect, it } from "vitest";
import { clientApiJavaScript } from "../src/cli/ui/clientApiSnippet.js";
import { buildAgentWindowPageHtml } from "../src/cli/agentWindowHtml.js";
import { buildDashboardPageHtml } from "../src/cli/ui/dashboardHtml.js";
import { buildMainTerminalHtml } from "../src/cli/ui/mainGridHtml.js";

describe("clientApiJavaScript", () => {
  it("exports withToken query-param auth and apiJson parse/HTTP guards", () => {
    const js = clientApiJavaScript();
    expect(js).toContain("function withToken");
    expect(js).toContain("async function apiJson");
    expect(js).toContain("token=");
    expect(js).toContain("encodeURIComponent(AUTH_TOKEN)");
    expect(js).toContain("JSON.parse");
    expect(js).toContain("non-json");
    expect(js).toContain("res.ok");
    expect(js).toContain('headers.Authorization = "Bearer " + AUTH_TOKEN');
    expect(js).not.toContain("/api/plans/inbox");
  });

  it("is interpolated into dashboard, agent window, and main grid", () => {
    const snippet = clientApiJavaScript();
    expect(buildDashboardPageHtml(undefined)).toContain("async function apiJson");
    expect(buildAgentWindowPageHtml(undefined)).toContain("async function apiJson");
    expect(buildMainTerminalHtml(undefined)).toContain("async function apiJson");
    expect(buildDashboardPageHtml("secret")).toContain(snippet.trim().slice(0, 40));
  });
});
