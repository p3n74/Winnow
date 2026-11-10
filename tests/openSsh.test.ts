import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { posixQuote, remoteCdAndExec, remoteGitAt, remotePathExpr } from "../src/ssh/remoteQuote.js";
import {
  buildSshArgv,
  probeSshWorkspace,
  remoteAgentCommand,
  sshExec,
  type SpawnLike,
} from "../src/ssh/openSsh.js";
import type { SshWorkspaceRef } from "../src/workspace/workspaceRef.js";

const ref: SshWorkspaceRef = {
  kind: "ssh",
  user: "deploy",
  host: "api.internal",
  port: 2222,
  remotePath: "/var/www/app",
  identityFile: "/keys/deploy",
};

function mockSpawn(exitCode: number, stdout = "", stderr = ""): SpawnLike {
  return ((_cmd, _args, _opts) => {
    const child = new EventEmitter() as ReturnType<SpawnLike>;
    const out = new EventEmitter();
    const err = new EventEmitter();
    (child as { stdout: EventEmitter }).stdout = out;
    (child as { stderr: EventEmitter }).stderr = err;
    (child as { kill: (sig?: string) => boolean }).kill = () => true;
    queueMicrotask(() => {
      if (stdout) {
        out.emit("data", Buffer.from(stdout));
      }
      if (stderr) {
        err.emit("data", Buffer.from(stderr));
      }
      child.emit("close", exitCode);
    });
    return child;
  }) as SpawnLike;
}

function mockHungSpawn(): SpawnLike {
  return ((_cmd, _args, _opts) => {
    const child = new EventEmitter() as ReturnType<SpawnLike>;
    (child as { stdout: EventEmitter }).stdout = new EventEmitter();
    (child as { stderr: EventEmitter }).stderr = new EventEmitter();
    (child as { kill: (sig?: string) => boolean }).kill = () => true;
    return child;
  }) as SpawnLike;
}

function mockSpawnError(message: string): SpawnLike {
  return ((_cmd, _args, _opts) => {
    const child = new EventEmitter() as ReturnType<SpawnLike>;
    (child as { stdout: EventEmitter }).stdout = new EventEmitter();
    (child as { stderr: EventEmitter }).stderr = new EventEmitter();
    (child as { kill: (sig?: string) => boolean }).kill = () => true;
    queueMicrotask(() => {
      child.emit("error", new Error(message));
    });
    return child;
  }) as SpawnLike;
}

function mockSpawnByRemote(
  replies: Array<{ test: (remote: string) => boolean; exitCode: number; stdout?: string; stderr?: string }>,
): SpawnLike {
  return ((_cmd, args) => {
    const remote = String(args.at(-1) ?? "");
    const reply = replies.find((item) => item.test(remote)) ?? {
      exitCode: 1,
      stderr: `unexpected remote command: ${remote}`,
    };
    const child = new EventEmitter() as ReturnType<SpawnLike>;
    const out = new EventEmitter();
    const err = new EventEmitter();
    (child as { stdout: EventEmitter }).stdout = out;
    (child as { stderr: EventEmitter }).stderr = err;
    (child as { kill: (sig?: string) => boolean }).kill = () => true;
    queueMicrotask(() => {
      if (reply.stdout) {
        out.emit("data", Buffer.from(reply.stdout));
      }
      if (reply.stderr) {
        err.emit("data", Buffer.from(reply.stderr));
      }
      child.emit("close", reply.exitCode);
    });
    return child;
  }) as SpawnLike;
}

describe("remoteQuote", () => {
  it("quotes single quotes for POSIX shells", () => {
    expect(posixQuote("it's")).toBe(`'it'\\''s'`);
    expect(posixQuote("")).toBe("''");
    expect(posixQuote("~/src/app")).toBe(`'~/src/app'`);
  });

  it("expands ~/ via $HOME instead of quoting the tilde", () => {
    expect(remotePathExpr("~/src/app")).toBe(`"$HOME/"'src/app'`);
    expect(remotePathExpr("~")).toBe(`"$HOME"`);
    expect(remotePathExpr("/var/www")).toBe(`'/var/www'`);
  });

  it("builds cd && exec and git -C commands", () => {
    expect(remoteCdAndExec("/var/www", ["cursor-agent", "--print"])).toBe(
      `cd '/var/www' && exec 'cursor-agent' '--print'`,
    );
    expect(remoteCdAndExec("~/src/app", ["cursor-agent"])).toBe(
      `cd "$HOME/"'src/app' && exec 'cursor-agent'`,
    );
    expect(remoteGitAt("/var/www", ["status", "--short"])).toBe(`git -C '/var/www' 'status' '--short'`);
    expect(remoteGitAt("~/src/app", ["status"])).toBe(`git -C "$HOME/"'src/app' 'status'`);
  });
});

describe("buildSshArgv", () => {
  it("uses BatchMode, ControlMaster, port, identity, and -- before the remote command", () => {
    const argv = buildSshArgv(ref, "test -d /var/www/app", { controlDir: "/tmp/winnow-ssh" });
    expect(argv).toContain("BatchMode=yes");
    expect(argv).toContain("ControlMaster=auto");
    expect(argv).toContain("ControlPath=/tmp/winnow-ssh/cm-%C");
    expect(argv.slice(argv.indexOf("-p"), argv.indexOf("-p") + 2)).toEqual(["-p", "2222"]);
    expect(argv.slice(argv.indexOf("-i"), argv.indexOf("-i") + 2)).toEqual(["-i", "/keys/deploy"]);
    expect(argv).toContain("-T");
    expect(argv).toContain("deploy@api.internal");
    expect(argv.at(-2)).toBe("--");
    expect(argv.at(-1)).toBe("test -d /var/www/app");
  });

  it("uses -t for PTY remotes and ConnectTimeout", () => {
    const argv = buildSshArgv(ref, "exec bash -l", {
      controlDir: "/tmp/winnow-ssh",
      tty: true,
      connectTimeoutSec: 5,
    });
    expect(argv).toContain("-t");
    expect(argv).not.toContain("-T");
    expect(argv).toContain("ConnectTimeout=5");
  });

  it("omits -p/-i when port and identityFile are unset", () => {
    const argv = buildSshArgv(
      { kind: "ssh", host: "box", remotePath: "/opt/app" },
      "true",
      { controlDir: "/tmp/winnow-ssh" },
    );
    expect(argv).not.toContain("-p");
    expect(argv).not.toContain("-i");
    expect(argv).toContain("box");
  });

  it("drops BatchMode when passwordAuth is on", () => {
    const argv = buildSshArgv(ref, "true", { controlDir: "/tmp/winnow-ssh", passwordAuth: true });
    expect(argv).not.toContain("BatchMode=yes");
    expect(argv).toContain("NumberOfPasswordPrompts=1");
    expect(argv).toContain("PreferredAuthentications=password,keyboard-interactive,publickey");
  });
});

describe("sshExec", () => {
  it("resolves ok from a successful mock ssh", async () => {
    const result = await sshExec(ref, "true", {
      spawnFn: mockSpawn(0, "ok\n"),
      controlDir: "/tmp/winnow-ssh",
    });
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("ok\n");
  });

  it("surfaces stderr when ssh exits non-zero", async () => {
    const result = await sshExec(ref, "false", {
      spawnFn: mockSpawn(255, "", "Permission denied\n"),
      controlDir: "/tmp/winnow-ssh",
    });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("Permission denied");
  });

  it("kills hung ssh and reports timeout", async () => {
    const result = await sshExec(ref, "sleep 999", {
      spawnFn: mockHungSpawn(),
      controlDir: "/tmp/winnow-ssh",
      timeoutMs: 25,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBeNull();
    expect(result.stderr).toMatch(/timed out after 25ms/);
  });

  it("maps spawn failures to ok:false", async () => {
    const result = await sshExec(ref, "true", {
      spawnFn: mockSpawnError("spawn ssh ENOENT"),
      controlDir: "/tmp/winnow-ssh",
    });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("ENOENT");
  });
});

describe("probeSshWorkspace", () => {
  const controlDir = "/tmp/winnow-ssh-probe";

  it("fails when the remote directory is missing or unreachable", async () => {
    const probed = await probeSshWorkspace(ref, {
      controlDir,
      spawnFn: mockSpawn(1, "", "No such file or directory\n"),
    });
    expect(probed.ok).toBe(false);
    if (!probed.ok) {
      expect(probed.error).toMatch(/Remote directory is not reachable/);
      expect(probed.error).toContain("/var/www/app");
      expect(probed.error).toMatch(/No such file or directory/);
    }
  });

  it("fails with permission denied on the directory probe", async () => {
    const probed = await probeSshWorkspace(ref, {
      controlDir,
      spawnFn: mockSpawn(255, "", "Permission denied (publickey).\n"),
    });
    expect(probed.ok).toBe(false);
    if (!probed.ok) {
      expect(probed.error).toMatch(/Permission denied/);
    }
  });

  it("succeeds when the remote directory exists (agent stays local)", async () => {
    const probed = await probeSshWorkspace(ref, {
      controlDir,
      spawnFn: mockSpawnByRemote([{ test: (remote) => remote.includes("test -d"), exitCode: 0, stdout: "" }]),
    });
    expect(probed).toEqual({ ok: true });
  });
});

describe("remoteAgentCommand", () => {
  it("cds into the remote path then execs cursor-agent", () => {
    expect(remoteAgentCommand(ref, "cursor-agent", ["--print", "--force"])).toBe(
      `cd '/var/www/app' && exec 'cursor-agent' '--print' '--force'`,
    );
    expect(remoteAgentCommand({ ...ref, remotePath: "~/proj" }, "cursor-agent", ["--print"])).toBe(
      `cd "$HOME/"'proj' && exec 'cursor-agent' '--print'`,
    );
  });
});
