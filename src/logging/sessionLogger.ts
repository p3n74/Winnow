import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { WinnowConfig } from "../config/schema.js";

type SessionLogEvent = {
  event: "session_start" | "session_end" | "translation_error" | "fallback";
  timestamp: string;
  backend: WinnowConfig["translatorBackend"];
  inputMode: WinnowConfig["inputMode"];
  outputMode: WinnowConfig["outputMode"];
  latencyMs?: number;
  detail?: string;
};

export class SessionLogger {
  constructor(private readonly config: WinnowConfig) {}

  async log(event: SessionLogEvent): Promise<void> {
    if (!this.config.logsEnabled) {
      return;
    }
    const absoluteDir = join(process.cwd(), this.config.logsDir);
    await mkdir(absoluteDir, { recursive: true });
    const filePath = join(absoluteDir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
  }
}
