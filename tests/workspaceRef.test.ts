import { describe, expect, it } from "vitest";
import {
  formatWorkspaceRef,
  looksLikeSshWorkspace,
  parseWorkspaceInput,
  sshDestination,
  workspaceCapabilities,
  workspaceDisplayName,
} from "../src/workspace/workspaceRef.js";

describe("looksLikeSshWorkspace", () => {
  it("accepts ssh URLs and scp-like user@host:/path", () => {
    expect(looksLikeSshWorkspace("ssh://me@box.example:/var/www")).toBe(true);
    expect(looksLikeSshWorkspace("ssh://me@box.example/var/www")).toBe(true);
    expect(looksLikeSshWorkspace("me@box.example:/var/www")).toBe(true);
    expect(looksLikeSshWorkspace("prod:/opt/app")).toBe(true);
    expect(looksLikeSshWorkspace("me@box:~/src/app")).toBe(true);
  });

  it("rejects local paths, Windows drives, and host:port without a path", () => {
    expect(looksLikeSshWorkspace("/Users/me/proj")).toBe(false);
    expect(looksLikeSshWorkspace("~/proj")).toBe(false);
    expect(looksLikeSshWorkspace("C:\\Users\\me")).toBe(false);
    expect(looksLikeSshWorkspace("C:/Users/me")).toBe(false);
    expect(looksLikeSshWorkspace("d:\\work\\app")).toBe(false);
    expect(looksLikeSshWorkspace("\\\\server\\share\\repo")).toBe(false);
    expect(looksLikeSshWorkspace("localhost:8080")).toBe(false);
    expect(looksLikeSshWorkspace("127.0.0.1:22")).toBe(false);
    expect(looksLikeSshWorkspace("api.internal:2222")).toBe(false);
    expect(looksLikeSshWorkspace("")).toBe(false);
    expect(looksLikeSshWorkspace("   ")).toBe(false);
  });

  it("does not treat scp-like host:relative as SSH (path must be / or ~/)", () => {
    expect(looksLikeSshWorkspace("box:src/app")).toBe(false);
    expect(looksLikeSshWorkspace("box:./src")).toBe(false);
    expect(looksLikeSshWorkspace("box:2222:/var/www")).toBe(false);
  });
});

describe("parseWorkspaceInput", () => {
  it("parses ssh:// URLs including port and identityFile", () => {
    const ref = parseWorkspaceInput("ssh://deploy@api.internal:2222/var/www/app?identityFile=/keys/deploy");
    expect(ref).toEqual({
      kind: "ssh",
      host: "api.internal",
      user: "deploy",
      port: 2222,
      remotePath: "/var/www/app",
      identityFile: "/keys/deploy",
    });
  });

  it("maps ssh://host/~/proj to a remote home-relative path", () => {
    const ref = parseWorkspaceInput("ssh://box/~/proj");
    expect(ref.kind).toBe("ssh");
    if (ref.kind === "ssh") {
      expect(ref.remotePath).toBe("~/proj");
      expect(ref.host).toBe("box");
    }
  });

  it("parses scp-like targets", () => {
    const ref = parseWorkspaceInput("deploy@api.internal:/var/www/app");
    expect(ref).toMatchObject({
      kind: "ssh",
      user: "deploy",
      host: "api.internal",
      remotePath: "/var/www/app",
    });
  });

  it("keeps local paths as local refs", () => {
    expect(parseWorkspaceInput("/tmp/winnow")).toEqual({ kind: "local", path: "/tmp/winnow" });
  });

  it("rejects ssh URLs without a remote directory", () => {
    expect(() => parseWorkspaceInput("ssh://box.example")).toThrow(/remote directory/i);
    expect(() => parseWorkspaceInput("ssh://box.example/")).toThrow(/remote directory/i);
    expect(() => parseWorkspaceInput("ssh://box.example?identityFile=/keys/a")).toThrow(/remote directory/i);
  });

  it("rejects empty input and URLs without a host", () => {
    expect(() => parseWorkspaceInput("")).toThrow(/required/i);
    expect(() => parseWorkspaceInput("   ")).toThrow(/required/i);
    expect(() => parseWorkspaceInput("ssh:///var/www")).toThrow(/host/i);
  });

  it("rejects an out-of-range or zero SSH port", () => {
    expect(() => parseWorkspaceInput("ssh://box:0/var/www")).toThrow(/Invalid SSH port/i);
    expect(() => parseWorkspaceInput("ssh://box:99999/opt/app")).toThrow(/Invalid SSH workspace URL/i);
  });

  it("keeps Windows drives and UNC paths local", () => {
    expect(parseWorkspaceInput("C:\\Users\\me\\proj")).toEqual({ kind: "local", path: "C:\\Users\\me\\proj" });
    expect(parseWorkspaceInput("C:/Users/me/proj")).toEqual({ kind: "local", path: "C:/Users/me/proj" });
    expect(parseWorkspaceInput("\\\\fileserver\\repos\\app")).toEqual({
      kind: "local",
      path: "\\\\fileserver\\repos\\app",
    });
  });

  it("parses IPv6 ssh URLs and colon-before-path ssh://host:/abs form", () => {
    const v6 = parseWorkspaceInput("ssh://[::1]/var/www");
    expect(v6).toMatchObject({ kind: "ssh", host: "[::1]", remotePath: "/var/www" });
    const colonPath = parseWorkspaceInput("ssh://me@box.example:/var/www");
    expect(colonPath).toMatchObject({ kind: "ssh", host: "box.example", user: "me", remotePath: "/var/www" });
  });

  it("keeps identityFile only when the query value is non-empty", () => {
    const withKey = parseWorkspaceInput("ssh://box/opt/app?identityFile=%2Fkeys%2Fdeploy");
    expect(withKey).toMatchObject({ kind: "ssh", identityFile: "/keys/deploy" });
    const blank = parseWorkspaceInput("ssh://box/opt/app?identityFile=");
    expect(blank.kind).toBe("ssh");
    if (blank.kind === "ssh") {
      expect(blank.identityFile).toBeUndefined();
    }
  });

  it("does not parse identityFile or port from scp-like targets", () => {
    const ref = parseWorkspaceInput("deploy@api.internal:~/src/app");
    expect(ref).toEqual({
      kind: "ssh",
      host: "api.internal",
      user: "deploy",
      remotePath: "~/src/app",
    });
  });
});

describe("formatWorkspaceRef", () => {
  it("round-trips ssh refs through URL form", () => {
    const formatted = formatWorkspaceRef({
      kind: "ssh",
      host: "api.internal",
      user: "deploy",
      port: 2222,
      remotePath: "/var/www/app",
      identityFile: "/keys/deploy",
    });
    expect(formatted).toContain("ssh://");
    expect(parseWorkspaceInput(formatted)).toMatchObject({
      kind: "ssh",
      host: "api.internal",
      user: "deploy",
      port: 2222,
      remotePath: "/var/www/app",
      identityFile: "/keys/deploy",
    });
  });

  it("round-trips home-relative remote paths used by ssh://host/~/proj", () => {
    const formatted = formatWorkspaceRef({
      kind: "ssh",
      host: "box",
      remotePath: "~/proj",
      identityFile: "/keys/a",
    });
    expect(parseWorkspaceInput(formatted)).toMatchObject({
      kind: "ssh",
      host: "box",
      remotePath: "~/proj",
      identityFile: "/keys/a",
    });
  });
});

describe("workspace helpers", () => {
  it("names ssh projects with host context", () => {
    expect(
      workspaceDisplayName({
        kind: "ssh",
        host: "box",
        user: "me",
        remotePath: "/var/www/app",
      }),
    ).toBe("app (me@box)");
    expect(sshDestination({ kind: "ssh", host: "box", remotePath: "/x" })).toBe("box");
  });

  it("disables graph/docs/fs on ssh capabilities", () => {
    expect(workspaceCapabilities("ssh").graph).toBe(false);
    expect(workspaceCapabilities("ssh").docs).toBe(false);
    expect(workspaceCapabilities("ssh").fs).toBe(false);
    expect(workspaceCapabilities("ssh").processes).toBe(false);
    expect(workspaceCapabilities("ssh").plans).toBe(false);
    expect(workspaceCapabilities("ssh").preview).toBe(false);
    expect(workspaceCapabilities("ssh").agent).toBe(true);
    expect(workspaceCapabilities("ssh").git).toBe(true);
    expect(workspaceCapabilities("ssh").pty).toBe(true);
    expect(workspaceCapabilities("local").graph).toBe(true);
  });

  it("names ~ remote paths without treating them as local home", () => {
    expect(
      workspaceDisplayName({
        kind: "ssh",
        host: "box",
        remotePath: "~/src/winnow",
      }),
    ).toBe("winnow (box)");
  });
});
