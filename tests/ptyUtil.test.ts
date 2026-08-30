import { describe, expect, it } from "vitest";
import {
  bashHasCommand,
  installDeadPtyResizeGuard,
  isDeadPtyResizeError,
  paneLaunchScript,
  quoteExecutableForBash,
  safePtyResize,
} from "../src/cli/ui/ptyUtil.js";

describe("quoteExecutableForBash", () => {
  it("quotes Windows Git Bash paths so exec survives spaces", () => {
    expect(quoteExecutableForBash("C:\\Program Files\\Git\\bin\\bash.exe")).toBe(
      "'C:/Program Files/Git/bin/bash.exe'",
    );
  });

  it("escapes single quotes inside the path", () => {
    expect(quoteExecutableForBash("/tmp/it's-bash")).toBe("'/tmp/it'\\''s-bash'");
  });
});

describe("dead PTY resize", () => {
  it("detects the node-pty Windows resize error", () => {
    expect(isDeadPtyResizeError(new Error("Cannot resize a pty that has already exited"))).toBe(true);
    expect(isDeadPtyResizeError(new Error("spawn failed"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("does not install an uncaughtException handler on Unix", () => {
    const before = process.listenerCount("uncaughtException");
    installDeadPtyResizeGuard();
    expect(process.listenerCount("uncaughtException")).toBe(before);
  });

  it("swallows dead-pty resize throws", () => {
    expect(() =>
      safePtyResize(
        {
          resize() {
            throw new Error("Cannot resize a pty that has already exited");
          },
        },
        80,
        24,
      ),
    ).not.toThrow();
  });
});

describe("paneLaunchScript", () => {
  const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "/bin/bash";
  const quoted = quoteExecutableForBash(bash);

  it("skips missing tools like ranger and just execs the shell", () => {
    expect(bashHasCommand(bash, "ranger-definitely-not-installed-xyz")).toBe(false);
    expect(paneLaunchScript(bash, "ranger-definitely-not-installed-xyz", quoted)).toBe(`exec ${quoted}`);
  });

  it("keeps commands that exist on PATH", () => {
    expect(bashHasCommand(bash, "ls")).toBe(true);
    expect(paneLaunchScript(bash, "ls", quoted)).toBe(`ls; exec ${quoted}`);
  });
});
