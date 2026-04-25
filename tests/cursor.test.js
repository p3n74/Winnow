import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { runCursorAgent } from "../src/cursor/runCursor.js";
class BufferWritable extends Writable {
    data = "";
    _write(chunk, _encoding, callback) {
        this.data += chunk.toString("utf8");
        callback();
    }
}
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
//# sourceMappingURL=cursor.test.js.map