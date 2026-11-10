import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  buildSshfsArgv,
  sshfsMountDir,
  sshfsSshWrapperScript,
  sshfsRemoteSpec,
  whichSshfs,
} from "../src/ssh/sshfsMount.js";
import type { SpawnLike } from "../src/ssh/openSsh.js";
import type { SshWorkspaceRef } from "../src/workspace/workspaceRef.js";

const ref: SshWorkspaceRef = {
  kind: "ssh",
  user: "deploy",
  host: "api.internal",
  port: 2222,
  remotePath: "/var/www/app",
};

function mockWhich(exitCode: number, stdout = ""): SpawnLike {
  return ((_cmd, _args) => {
    const child = new EventEmitter() as ReturnType<SpawnLike>;
    const out = new EventEmitter();
    (child as { stdout: EventEmitter }).stdout = out;
    (child as { stderr: EventEmitter }).stderr = new EventEmitter();
    queueMicrotask(() => {
      if (stdout) {
        out.emit("data", Buffer.from(stdout));
      }
      child.emit("close", exitCode);
    });
    return child;
  }) as SpawnLike;
}

describe("sshfs helpers", () => {
  it("builds a remote spec and a stable local mount dir", () => {
    expect(sshfsRemoteSpec(ref)).toBe("deploy@api.internal:/var/www/app");
    expect(sshfsMountDir(ref)).toMatch(/\.winnow[/\\]ssh-mounts[/\\][0-9a-f]{16}$/);
    expect(sshfsMountDir(ref)).toBe(sshfsMountDir(ref));
  });

  it("keeps OpenSSH flags out of FUSE -o (commas and -p break macFUSE)", () => {
    const argv = buildSshfsArgv(ref, "/mnt/winnow", {
      sshCommand: "/tmp/winnow-ssh/sshfs-abc.sh",
      passwordAuth: true,
    });
    expect(argv[0]).toBe("deploy@api.internal:/var/www/app");
    expect(argv[1]).toBe("/mnt/winnow");
    const joined = argv.join(" ");
    expect(joined).toContain("ssh_command=/tmp/winnow-ssh/sshfs-abc.sh");
    expect(joined).not.toContain("PreferredAuthentications");
    expect(joined).not.toContain("keyboard-interactive");
    expect(joined).not.toMatch(/(^|\s)-p\s/);
    expect(joined).not.toContain(",");

    const wrapper = sshfsSshWrapperScript(ref, { controlDir: "/tmp/cm", passwordAuth: true });
    expect(wrapper).toContain("#!/bin/sh");
    expect(wrapper).toContain("'-p' '2222'");
    expect(wrapper).toContain("PreferredAuthentications=password,keyboard-interactive,publickey");
  });

  it("resolves sshfs from which stdout", async () => {
    await expect(whichSshfs(mockWhich(0, "/opt/homebrew/bin/sshfs\n"))).resolves.toBe("/opt/homebrew/bin/sshfs");
    await expect(whichSshfs(mockWhich(1, ""))).resolves.toBeNull();
  });
});
