import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { WinnowConfig } from "../config/schema.js";
import { runWinnowSession } from "../pipeline/session.js";

export async function runInteractiveSession(
  baseConfig: WinnowConfig,
  args: string[],
): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let config = { ...baseConfig };

  stdout.write("Winnow session mode. Commands: :zh :raw :dual :quit\n");

  while (true) {
    const line = (await rl.question("> ")).trim();
    if (!line) {
      continue;
    }

    if (line === ":quit" || line === ":q") {
      break;
    }

    if (line === ":zh") {
      config = { ...config, outputMode: "en_to_zh", showOriginal: false, dualOutput: false };
      stdout.write("[winnow] mode switched to Chinese output.\n");
      continue;
    }

    if (line === ":raw") {
      config = { ...config, inputMode: "off", outputMode: "off", showOriginal: false, dualOutput: false };
      stdout.write("[winnow] mode switched to raw passthrough.\n");
      continue;
    }

    if (line === ":dual") {
      config = { ...config, outputMode: "en_to_zh", showOriginal: true, dualOutput: true };
      stdout.write("[winnow] mode switched to bilingual output.\n");
      continue;
    }

    await runWinnowSession({ config, args, stdinOverride: `${line}\n` });
  }

  rl.close();
}
