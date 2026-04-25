import { spawn } from "node:child_process";
import { WinnowConfig } from "../config/schema.js";
import { OllamaTranslator } from "../translator/ollamaTranslator.js";
import { runCursorAgent } from "../cursor/runCursor.js";

type SessionOptions = {
  config: WinnowConfig;
  args: string[];
};

function chunkBySentence(input: string, maxChunkLength = 1200): string[] {
  const sentences = input
    .split(/(?<=[.!?。！？])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buffer = "";

  for (const sentence of sentences) {
    const next = buffer ? `${buffer} ${sentence}` : sentence;
    if (next.length > maxChunkLength && buffer) {
      chunks.push(buffer);
      buffer = sentence;
    } else {
      buffer = next;
    }
  }

  if (buffer) {
    chunks.push(buffer);
  }

  return chunks.length > 0 ? chunks : [input];
}

function isTranslationActive(config: WinnowConfig): boolean {
  return config.inputMode !== "off" || config.outputMode !== "off";
}

function readStdinIfPiped(): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      resolve(undefined);
      return;
    }

    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function runAndCapture(command: string, args: string[], stdinText?: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.on("error", reject);

    child.stdout?.on("data", (buf: Buffer) => {
      stdout += buf.toString("utf8");
    });
    child.stderr?.on("data", (buf: Buffer) => {
      stderr += buf.toString("utf8");
    });

    if (stdinText !== undefined) {
      child.stdin?.write(stdinText);
      child.stdin?.end();
    } else {
      process.stdin.pipe(child.stdin!);
    }

    child.on("close", (code: number | null) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function runWinnowSession({ config, args }: SessionOptions): Promise<number> {
  const stdinText = await readStdinIfPiped();

  if (!isTranslationActive(config)) {
    return runCursorAgent({
      command: config.cursorCommand,
      args,
      stdinText,
    });
  }

  const translator = new OllamaTranslator(config);
  const translatedInput = stdinText ? await translator.translateInput(stdinText) : undefined;

  const result = await runAndCapture(config.cursorCommand, args, translatedInput);

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (!result.stdout) {
    return result.code;
  }

  try {
    const translatedChunks: string[] = [];
    for (const chunk of chunkBySentence(result.stdout)) {
      translatedChunks.push(await translator.translateOutput(chunk));
    }
    const translatedOutput = translatedChunks.join("\n");
    if (config.showOriginal) {
      process.stdout.write(`[original]\n${result.stdout}\n\n`);
    }
    process.stdout.write(`${translatedOutput}\n`);
  } catch (error) {
    process.stderr.write(
      `[winnow] translation fallback: ${(error as Error).message}. Returning original output.\n`,
    );
    process.stdout.write(result.stdout);
  }

  return result.code;
}
