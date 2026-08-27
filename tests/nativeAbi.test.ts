import { describe, expect, it } from "vitest";
import { isNativeAbiMismatch, NATIVE_PACKAGES, pathWithRunningNode } from "../scripts/nativeAbi.mjs";

describe("isNativeAbiMismatch", () => {
  it("detects Node addon ABI errors", () => {
    expect(
      isNativeAbiMismatch(
        "was compiled against a different Node.js version using NODE_MODULE_VERSION 127",
      ),
    ).toBe(true);
    expect(isNativeAbiMismatch("Error: ERR_DLOPEN_FAILED")).toBe(true);
  });

  it("ignores unrelated failures", () => {
    expect(isNativeAbiMismatch("Git Bash not found")).toBe(false);
    expect(isNativeAbiMismatch("")).toBe(false);
  });
});

describe("pathWithRunningNode", () => {
  it("puts the running Node.js bin directory first on PATH", () => {
    const next = pathWithRunningNode("/usr/bin:/bin", "/opt/homebrew/Cellar/node/26.0.0/bin/node", ":");
    expect(next.startsWith("/opt/homebrew/Cellar/node/26.0.0/bin:")).toBe(true);
  });
});

describe("NATIVE_PACKAGES", () => {
  it("includes sqlite and pty addons", () => {
    expect(NATIVE_PACKAGES).toEqual(["better-sqlite3", "node-pty"]);
  });
});
