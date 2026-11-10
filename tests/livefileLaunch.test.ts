import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveLivefileLaunch } from "../src/cli/ui/livefileLaunch.js";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "winnow-livefile-"));
}

describe("resolveLivefileLaunch", () => {
  it("prefers WINNOW_LIVEFILE when that file exists", () => {
    const root = tempRoot();
    const script = join(root, "cli.js");
    writeFileSync(script, "#!/usr/bin/env node\n");
    const launch = resolveLivefileLaunch({
      env: { WINNOW_LIVEFILE: script, PATH: "" },
      siblingRoots: [],
      execPath: "/usr/bin/node",
    });
    expect(launch).toEqual({ file: "/usr/bin/node", args: [script] });
  });

  it("uses an executable named livefile on PATH", () => {
    const root = tempRoot();
    const bin = join(root, "livefile");
    writeFileSync(bin, "#!/bin/sh\n");
    chmodSync(bin, 0o755);
    const launch = resolveLivefileLaunch({
      env: { PATH: root },
      siblingRoots: [],
      execPath: "/usr/bin/node",
    });
    expect(launch).toEqual({ file: bin, args: [] });
  });

  it("falls back to a LiveFile checkout next to a sibling root", () => {
    const parent = tempRoot();
    const winnow = join(parent, "winnow");
    const script = join(parent, "LiveFile", "src", "cli.js");
    mkdirSync(join(parent, "LiveFile", "src"), { recursive: true });
    mkdirSync(winnow);
    writeFileSync(script, "export {};\n");
    const launch = resolveLivefileLaunch({
      env: { PATH: "" },
      siblingRoots: [winnow],
      execPath: "/usr/bin/node",
    });
    expect(launch).toEqual({ file: "/usr/bin/node", args: [script] });
  });

  it("returns null when nothing is installed", () => {
    expect(
      resolveLivefileLaunch({
        env: { PATH: "" },
        siblingRoots: [tempRoot()],
        execPath: "/usr/bin/node",
      }),
    ).toBeNull();
  });
});
