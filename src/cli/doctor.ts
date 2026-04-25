import { spawn } from "node:child_process";
import { WinnowConfig } from "../config/schema.js";

function runCommand(command: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout?.on("data", (buf: Buffer) => {
      output += buf.toString("utf8");
    });
    child.stderr?.on("data", (buf: Buffer) => {
      output += buf.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ ok: false, output: error.message });
    });
    child.on("close", (code: number | null) => {
      resolve({ ok: code === 0, output: output.trim() });
    });
  });
}

export async function runDoctor(config: WinnowConfig): Promise<number> {
  let hasFailure = false;

  const cursorCheck = await runCommand(config.cursorCommand, ["--help"]);
  process.stdout.write(
    `Cursor command (${config.cursorCommand}): ${cursorCheck.ok ? "OK" : "FAIL"}\n`,
  );
  if (!cursorCheck.ok) {
    hasFailure = true;
    process.stdout.write(`  detail: ${cursorCheck.output}\n`);
  }

  if (config.translatorBackend === "ollama") {
    const ollamaCheck = await fetch(`${config.ollamaBaseUrl}/api/tags`).then(
      (res) => ({ ok: res.ok, status: res.status }),
      () => ({ ok: false, status: 0 }),
    );
    process.stdout.write(
      `Ollama backend (${config.ollamaBaseUrl}): ${ollamaCheck.ok ? "OK" : "FAIL"}\n`,
    );
    if (!ollamaCheck.ok) {
      hasFailure = true;
    }
  } else {
    const deepseekCheck = await fetch(`${config.deepseekBaseUrl}/v1/models`, {
      headers: {
        Authorization: `Bearer ${config.deepseekApiKey}`,
      },
    }).then(
      (res) => ({ ok: res.ok, status: res.status }),
      () => ({ ok: false, status: 0 }),
    );
    process.stdout.write(
      `DeepSeek backend (${config.deepseekBaseUrl}): ${deepseekCheck.ok ? "OK" : "FAIL"}\n`,
    );
    if (!deepseekCheck.ok) {
      hasFailure = true;
    }
  }

  process.stdout.write(`Translator retries/timeout: ${config.translatorRetries}/${config.translatorTimeoutMs}ms\n`);
  process.stdout.write(`Session logs: ${config.logsEnabled ? "enabled" : "disabled"} (${config.logsDir})\n`);
  return hasFailure ? 1 : 0;
}
