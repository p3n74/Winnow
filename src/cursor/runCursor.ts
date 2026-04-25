import { spawn } from "node:child_process";
import { Writable } from "node:stream";

type RunCursorOptions = {
  command: string;
  args: string[];
  stdinText?: string;
  stdout?: Writable;
  stderr?: Writable;
};

export async function runCursorAgent({
  command,
  args,
  stdinText,
  stdout = process.stdout,
  stderr = process.stderr,
}: RunCursorOptions): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    child.on("error", reject);

    if (child.stdout) {
      child.stdout.pipe(stdout);
    }

    if (child.stderr) {
      child.stderr.pipe(stderr);
    }

    if (stdinText !== undefined) {
      child.stdin?.write(stdinText);
      child.stdin?.end();
    } else {
      process.stdin.pipe(child.stdin!);
    }

    child.on("close", (code: number | null) => {
      resolve(code ?? 1);
    });
  });
}
