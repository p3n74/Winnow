import { describe, expect, it } from "vitest";
import {
  formatNativeDoctorLine,
  formatNativeRebuildHint,
  nativeDoctorResult,
  probeNativeModules,
} from "../src/cli/doctor.js";
import { isNativeAbiMismatch, NATIVE_PACKAGES } from "../scripts/nativeAbi.mjs";

const ABI_ERROR =
  "The module was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 137. Error: ERR_DLOPEN_FAILED";

describe("nativeDoctorResult", () => {
  it("returns fail and flags ABI mismatch on a fake addon error string", () => {
    expect(isNativeAbiMismatch(ABI_ERROR)).toBe(true);
    const result = nativeDoctorResult("better-sqlite3", false, ABI_ERROR);
    expect(result.ok).toBe(false);
    expect(result.abiMismatch).toBe(true);
    expect(formatNativeDoctorLine(result)).toBe(`better-sqlite3: FAIL — ${ABI_ERROR}`);
    expect(formatNativeRebuildHint()).toBe(
      `hint: run \`npm run setup\` or \`npm rebuild ${NATIVE_PACKAGES.join(" ")}\``,
    );
  });

  it("returns ok on success", () => {
    const result = nativeDoctorResult("node-pty", true, "");
    expect(result.ok).toBe(true);
    expect(result.abiMismatch).toBe(false);
    expect(formatNativeDoctorLine(result)).toBe("node-pty: OK");
  });

  it("does not treat missing-module errors as ABI mismatches", () => {
    const result = nativeDoctorResult("better-sqlite3", false, "Cannot find module 'better-sqlite3'");
    expect(result.ok).toBe(false);
    expect(result.abiMismatch).toBe(false);
    expect(formatNativeDoctorLine(result)).toMatch(/^better-sqlite3: FAIL — Cannot find module/);
  });
});

describe("probeNativeModules", () => {
  it("loads better-sqlite3 and node-pty on this machine", async () => {
    const results = await probeNativeModules();
    expect(results.map((row) => row.name)).toEqual([...NATIVE_PACKAGES]);
    expect(results.every((row) => row.ok)).toBe(true);
    expect(results.map((row) => formatNativeDoctorLine(row))).toEqual(
      NATIVE_PACKAGES.map((name) => `${name}: OK`),
    );
  });
});
