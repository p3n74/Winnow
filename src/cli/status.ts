import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { WinnowConfig } from "../config/schema.js";

async function readLastLogEvent(config: WinnowConfig): Promise<string> {
  try {
    const dir = join(process.cwd(), config.logsDir);
    const files = (await readdir(dir))
      .filter((name) => name.endsWith(".jsonl"))
      .sort();
    if (files.length === 0) {
      return "none";
    }
    const latestFile = files[files.length - 1];
    const content = await readFile(join(dir, latestFile), "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    if (lines.length === 0) {
      return "none";
    }
    const last = JSON.parse(lines[lines.length - 1]) as {
      event?: string;
      timestamp?: string;
      detail?: string;
    };
    const detail = last.detail ? ` (${last.detail})` : "";
    return `${last.event ?? "unknown"} @ ${last.timestamp ?? "unknown"}${detail}`;
  } catch {
    return "none";
  }
}

export async function runStatus(config: WinnowConfig): Promise<number> {
  const activeModel =
    config.translatorBackend === "deepseek_api" ? config.deepseekModel : config.ollamaTranslationModel;
  const lastEvent = await readLastLogEvent(config);
  process.stdout.write(`backend=${config.translatorBackend}\n`);
  process.stdout.write(`model=${activeModel}\n`);
  process.stdout.write(`input_mode=${config.inputMode} output_mode=${config.outputMode}\n`);
  process.stdout.write(`profile=${config.profile} dual_output=${config.dualOutput}\n`);
  process.stdout.write(
    `timeout_ms=${config.translatorTimeoutMs} retries=${config.translatorRetries}\n`,
  );
  process.stdout.write(`logs=${config.logsEnabled ? "enabled" : "disabled"} path=${config.logsDir}\n`);
  process.stdout.write(`last_session=${lastEvent}\n`);
  return 0;
}
