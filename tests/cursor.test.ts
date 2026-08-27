import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { runCursorAgent } from "../src/cursor/runCursor.js";
import { cursorProjectIdFromWorkspaceRoot, isCursorChatSessionId, resolveCursorResumeId } from "../src/cursor/sessionUtils.js";

class BufferWritable extends Writable {
  public data = "";
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.data += chunk.toString("utf8");
    callback();
  }
}

describe("isCursorChatSessionId", () => {
  it("accepts Cursor UUIDs and rejects Winnow local ids", () => {
    expect(isCursorChatSessionId("c6b62c6f-7ead-4fd6-9922-e952131177ff")).toBe(true);
    expect(isCursorChatSessionId("1787838900103-zxugon")).toBe(false);
  });
});

describe("resolveCursorResumeId", () => {
  it("does not treat a Winnow local session id as --resume", () => {
    const resolved = resolveCursorResumeId({
      payloadSessionId: "1787838900103-zxugon",
      storedCursorSessionId: "",
      resumeArgIds: [],
    });
    expect(resolved.resumeId).toBe("");
    expect(resolved.droppedArgIds).toEqual([]);
  });

  it("resumes the stored Cursor UUID when continuing a Winnow session", () => {
    const resolved = resolveCursorResumeId({
      payloadSessionId: "1787838900103-zxugon",
      storedCursorSessionId: "c6b62c6f-7ead-4fd6-9922-e952131177ff",
      resumeArgIds: [],
    });
    expect(resolved.resumeId).toBe("c6b62c6f-7ead-4fd6-9922-e952131177ff");
    expect(resolved.droppedArgIds).toEqual([]);
  });

  it("prefers the client Cursor UUID over a stored UUID", () => {
    const resolved = resolveCursorResumeId({
      payloadSessionId: "1787838900103-zxugon",
      payloadCursorSessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      storedCursorSessionId: "c6b62c6f-7ead-4fd6-9922-e952131177ff",
      resumeArgIds: [],
    });
    expect(resolved.resumeId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("ignores a Winnow local id sent as payloadCursorSessionId", () => {
    const resolved = resolveCursorResumeId({
      payloadSessionId: "1787838900103-zxugon",
      payloadCursorSessionId: "1787838900103-zxugon",
      storedCursorSessionId: "c6b62c6f-7ead-4fd6-9922-e952131177ff",
      resumeArgIds: [],
    });
    expect(resolved.resumeId).toBe("c6b62c6f-7ead-4fd6-9922-e952131177ff");
  });
});
describe("cursorProjectIdFromWorkspaceRoot", () => {
  it("maps POSIX paths to Cursor-style project ids", () => {
    expect(cursorProjectIdFromWorkspaceRoot("/Users/dev/repos/winnow")).toBe("Users-dev-repos-winnow");
  });

  it.skipIf(process.platform !== "win32")("maps Windows paths to lowercased-drive ids", () => {
    expect(cursorProjectIdFromWorkspaceRoot("C:\\Users\\dev\\winnow")).toBe("c-Users-dev-winnow");
  });
});

describe("runCursorAgent", () => {
  it("preserves child exit code and streams output", async () => {
    const stdout = new BufferWritable();
    const stderr = new BufferWritable();
    const code = await runCursorAgent({
      command: "node",
      args: ["-e", "process.stdout.write('ok'); process.stderr.write('warn'); process.exit(3)"],
      stdout,
      stderr,
    });

    expect(code).toBe(3);
    expect(stdout.data).toContain("ok");
    expect(stderr.data).toContain("warn");
  });
});
