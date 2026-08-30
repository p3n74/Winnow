import { WinnowConfig } from "../config/schema.js";
import { spawnCommand } from "../cursor/spawnCommand.js";
import { isNativeAbiMismatch, NATIVE_PACKAGES } from "../../scripts/nativeAbi.mjs";

function runCommand(command: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawnCommand(command, args, { stdio: ["ignore", "pipe", "pipe"] });
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

export type NativeDoctorResult = {
  name: string;
  ok: boolean;
  message: string;
  abiMismatch: boolean;
};

export function nativeDoctorResult(name: string, ok: boolean, message = ""): NativeDoctorResult {
  return {
    name,
    ok,
    message,
    abiMismatch: !ok && isNativeAbiMismatch(message),
  };
}

export function formatNativeDoctorLine(result: NativeDoctorResult): string {
  if (result.ok) {
    return `${result.name}: OK`;
  }
  const message = result.message.replace(/\s+/g, " ").trim();
  const clipped = message.length > 280 ? `${message.slice(0, 280)}…` : message;
  return clipped ? `${result.name}: FAIL — ${clipped}` : `${result.name}: FAIL`;
}

export function formatNativeRebuildHint(packages: readonly string[] = NATIVE_PACKAGES): string {
  return `hint: run \`npm run setup\` or \`npm rebuild ${packages.join(" ")}\``;
}

async function probeNativePackage(name: string): Promise<{ ok: boolean; message: string }> {
  try {
    const mod = (await import(name)) as { default?: unknown; spawn?: unknown };
    if (name === "better-sqlite3") {
      const Database = mod.default as new (path: string) => {
        prepare(sql: string): { get(): unknown };
        close(): void;
      };
      const db = new Database(":memory:");
      try {
        db.prepare("SELECT 1 AS ok").get();
      } finally {
        db.close();
      }
    } else if (name === "node-pty") {
      const pty = (mod.default ?? mod) as { spawn?: unknown };
      if (typeof pty.spawn !== "function") {
        throw new Error("node-pty loaded but spawn is missing");
      }
    }
    return { ok: true, message: "" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function probeNativeModules(
  packages: readonly string[] = NATIVE_PACKAGES,
): Promise<NativeDoctorResult[]> {
  const results: NativeDoctorResult[] = [];
  for (const name of packages) {
    const probed = await probeNativePackage(name);
    results.push(nativeDoctorResult(name, probed.ok, probed.message));
  }
  return results;
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

  const nativeResults = await probeNativeModules();
  for (const result of nativeResults) {
    process.stdout.write(`${formatNativeDoctorLine(result)}\n`);
    if (!result.ok) {
      hasFailure = true;
      if (result.abiMismatch) {
        process.stdout.write(`  ${formatNativeRebuildHint()}\n`);
      }
    }
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
    if (!config.deepseekApiKey?.trim()) {
      process.stdout.write("DeepSeek backend: SKIP (no DEEPSEEK_API_KEY)\n");
      hasFailure = true;
    } else {
      const { smokeTestDeepseekChat } = await import("../translator/deepseekChat.js");
      const smoke = await smokeTestDeepseekChat(config);
      process.stdout.write(
        `DeepSeek chat API (${smoke.lastUrl || config.deepseekBaseUrl}): ${smoke.ok ? "OK" : "FAIL"}${
          smoke.error ? ` — ${smoke.error}` : ""
        }\n`,
      );
      if (!smoke.ok) {
        hasFailure = true;
        if (smoke.attemptedUrls.length > 1) {
          process.stdout.write(`  tried: ${smoke.attemptedUrls.join(" → ")}\n`);
        }
        if (smoke.lastBodySnippet) {
          const oneLine = smoke.lastBodySnippet.replace(/\s+/g, " ").slice(0, 280);
          process.stdout.write(`  response: ${oneLine}${smoke.lastBodySnippet.length > 280 ? "…" : ""}\n`);
        }
      }
    }
  }

  process.stdout.write(`Translator retries/timeout: ${config.translatorRetries}/${config.translatorTimeoutMs}ms\n`);
  process.stdout.write(`Session logs: ${config.logsEnabled ? "enabled" : "disabled"} (${config.logsDir})\n`);
  return hasFailure ? 1 : 0;
}
