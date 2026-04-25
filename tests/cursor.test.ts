import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { runCursorAgent } from "../src/cursor/runCursor.js";
import { cursorProjectIdFromWorkspaceRoot } from "../src/cursor/sessionUtils.js";

class BufferWritable extends Writable {
  public data = "";
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.data += chunk.toString("utf8");
    callback();
  }
}

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
