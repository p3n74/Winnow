import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createAskpassSession, isSshAuthFailure } from "../src/ssh/askpass.js";

describe("isSshAuthFailure", () => {
  it("detects permission denied and related auth errors", () => {
    expect(isSshAuthFailure("Permission denied (publickey).")).toBe(true);
    expect(isSshAuthFailure("Authentication failed.")).toBe(true);
    expect(isSshAuthFailure("No such file or directory")).toBe(false);
  });
});

describe("createAskpassSession", () => {
  it("prints the password from the helper and disposes files", async () => {
    const session = await createAskpassSession("s3cret-pass", tmpdir());
    try {
      const printed = spawnSync(session.scriptPath, [], { encoding: "utf8" });
      expect(printed.status).toBe(0);
      expect(printed.stdout).toBe("s3cret-pass");
      expect(session.env.SSH_ASKPASS).toBe(session.scriptPath);
      expect(session.env.SSH_ASKPASS_REQUIRE).toBe("force");
    } finally {
      await session.dispose();
    }
  });
});
