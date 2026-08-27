import { describe, expect, it } from "vitest";
import {
  extractLoginUrl,
  mergeCursorAccount,
  parseCursorAboutPayload,
  parseCursorStatusPayload,
  parseCursorUpdateOutput,
} from "../src/cursor/cursorAccount.js";

describe("parseCursorStatusPayload", () => {
  it("reads authenticated JSON", () => {
    const parsed = parseCursorStatusPayload(
      JSON.stringify({
        status: "authenticated",
        isAuthenticated: true,
        userInfo: { email: "nikolai@citadel-codex.com", userId: 1 },
      }),
    );
    expect(parsed.loggedIn).toBe(true);
    expect(parsed.email).toBe("nikolai@citadel-codex.com");
  });

  it("reads unauthenticated JSON", () => {
    const parsed = parseCursorStatusPayload(JSON.stringify({ status: "unauthenticated", isAuthenticated: false }));
    expect(parsed.loggedIn).toBe(false);
  });
});

describe("parseCursorAboutPayload", () => {
  it("reads account fields from JSON", () => {
    const parsed = parseCursorAboutPayload(
      JSON.stringify({
        cliVersion: "2026.08.25-3e8eec8",
        subscriptionTier: "Pro",
        userEmail: "nikolai@citadel-codex.com",
      }),
    );
    expect(parsed.subscriptionTier).toBe("Pro");
    expect(parsed.cliVersion).toBe("2026.08.25-3e8eec8");
  });
});

describe("parseCursorUpdateOutput", () => {
  it("detects up to date vs login required", () => {
    expect(parseCursorUpdateOutput("Checking for updates...\nAlready up to date").upToDate).toBe(true);
    expect(parseCursorUpdateOutput("Authentication required. Please run 'agent login' first.").needsLogin).toBe(true);
  });
});

describe("mergeCursorAccount", () => {
  it("needs login when status is not authenticated", () => {
    const snapshot = mergeCursorAccount({
      status: { loggedIn: false, email: "" },
      about: { email: "", subscriptionTier: "", cliVersion: "" },
      update: { upToDate: false, needsLogin: false, message: "" },
    });
    expect(snapshot.needsLogin).toBe(true);
    expect(snapshot.loggedIn).toBe(false);
  });
});

describe("extractLoginUrl", () => {
  it("pulls the first URL from login output", () => {
    expect(extractLoginUrl("Open https://cursor.com/loginCli?token=abc to continue")).toBe(
      "https://cursor.com/loginCli?token=abc",
    );
  });
});
