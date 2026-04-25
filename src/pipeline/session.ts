import { spawn } from "node:child_process";
import { WinnowConfig } from "../config/schema.js";
import { createTranslator } from "../translator/factory.js";
import { runCursorAgent } from "../cursor/runCursor.js";
import { SessionLogger } from "../logging/sessionLogger.js";

type SessionOptions = {
  config: WinnowConfig;
  args: string[];
  stdinOverride?: string;
};

export function chunkBySentence(input: string, maxChunkLength = 1200): string[] {
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

async function runWithStreamingTranslation(
  config: WinnowConfig,
  args: string[],
  translatedInput: string | undefined,
): Promise<number> {
  const translator = createTranslator(config);

  return new Promise<number>((resolve, reject) => {
    const child = spawn(config.cursorCommand, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    let outputBuffer = "";
    let rawOutput = "";
    let chain = Promise.resolve();

    const flushChunk = (chunk: string) => {
      if (!chunk.trim()) {
        return;
      }
      chain = chain.then(async () => {
        const translated = await translator.translateOutput(chunk);
        process.stdout.write(`${translated}\n`);
      });
    };

    child.on("error", reject);

    child.stderr?.on("data", (buf: Buffer) => {
      process.stderr.write(buf.toString("utf8"));
    });

    child.stdout?.on("data", (buf: Buffer) => {
      const text = buf.toString("utf8");
      rawOutput += text;
      outputBuffer += text;

      const pieces = chunkBySentence(outputBuffer);
      if (pieces.length > 1) {
        for (let i = 0; i < pieces.length - 1; i += 1) {
          flushChunk(pieces[i]);
        }
        outputBuffer = pieces[pieces.length - 1];
      }
    });

    if (translatedInput !== undefined) {
      child.stdin?.write(translatedInput);
      child.stdin?.end();
    } else {
      process.stdin.pipe(child.stdin!);
    }

    child.on("close", async (code: number | null) => {
      try {
        flushChunk(outputBuffer);
        await chain;

        if (config.showOriginal) {
          process.stdout.write(`\n[original]\n${rawOutput}\n`);
        }
        resolve(code ?? 1);
      } catch (error) {
        process.stderr.write(
          `[winnow] streaming translation fallback: ${(error as Error).message}. Returning original output.\n`,
        );
        process.stdout.write(rawOutput);
        resolve(code ?? 1);
      }
    });
  });
}

function getEffectiveArgs(config: WinnowConfig, args: string[], isInteractiveLoop: boolean): string[] {
  let effectiveArgs = [...args];
  if (config.sessionId) {
    if (!effectiveArgs.includes("--resume")) {
      effectiveArgs.push("--resume", config.sessionId);
    }
    if (!effectiveArgs.includes("--print")) {
      effectiveArgs.push("--print");
    }
  } else if (isInteractiveLoop || isTranslationActive(config)) {
    // If we are in an interactive loop or translating, we generally want --print 
    // so we can capture and process the output.
    if (!effectiveArgs.includes("--print")) {
      effectiveArgs.push("--print");
    }
  }
  return effectiveArgs;
}

export async function runWinnowSession({ config, args, stdinOverride }: SessionOptions): Promise<number> {
  const logger = new SessionLogger(config);
  const start = Date.now();
  const isInteractiveLoop = stdinOverride !== undefined;
  const effectiveArgs = getEffectiveArgs(config, args, isInteractiveLoop);

  await logger.log({
    event: "session_start",
    timestamp: new Date().toISOString(),
    backend: config.translatorBackend,
    inputMode: config.inputMode,
    outputMode: config.outputMode,
    detail: config.sessionId ? `session_id: ${config.sessionId}` : undefined,
  });

  const stdinText = stdinOverride ?? (await readStdinIfPiped());

  if (!isTranslationActive(config)) {
    const code = await runCursorAgent({
      command: config.cursorCommand,
      args: effectiveArgs,
      stdinText,
    });
    await logger.log({
      event: "session_end",
      timestamp: new Date().toISOString(),
      backend: config.translatorBackend,
      inputMode: config.inputMode,
      outputMode: config.outputMode,
      latencyMs: Date.now() - start,
    });
    return code;
  }

  const translator = createTranslator(config);
  let translatedInput = stdinText;
  if (stdinText) {
    try {
      translatedInput = await translator.translateInput(stdinText);
    } catch (error) {
      await logger.log({
        event: "fallback",
        timestamp: new Date().toISOString(),
        backend: config.translatorBackend,
        inputMode: config.inputMode,
        outputMode: config.outputMode,
        detail: `input_translation_failed: ${(error as Error).message}`,
      });
      translatedInput = stdinText;
    }
  }

  if (config.outputMode !== "off") {
    const code = await runWithStreamingTranslation(config, effectiveArgs, translatedInput);
    await logger.log({
      event: "session_end",
      timestamp: new Date().toISOString(),
      backend: config.translatorBackend,
      inputMode: config.inputMode,
      outputMode: config.outputMode,
      latencyMs: Date.now() - start,
    });
    return code;
  }

  const result = await runAndCapture(config.cursorCommand, effectiveArgs, translatedInput);

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
    await logger.log({
      event: "translation_error",
      timestamp: new Date().toISOString(),
      backend: config.translatorBackend,
      inputMode: config.inputMode,
      outputMode: config.outputMode,
      detail: (error as Error).message,
    });
    process.stderr.write(
      `[winnow] translation fallback: ${(error as Error).message}. Returning original output.\n`,
    );
    process.stdout.write(result.stdout);
  }

  await logger.log({
    event: "session_end",
    timestamp: new Date().toISOString(),
    backend: config.translatorBackend,
    inputMode: config.inputMode,
    outputMode: config.outputMode,
    latencyMs: Date.now() - start,
  });
  return result.code;
}
