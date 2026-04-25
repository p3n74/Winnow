import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { WinnowConfig } from "../config/schema.js";
import { saveProjectProfile } from "../config/projectProfile.js";
import { runWinnowSession } from "../pipeline/session.js";

export async function runInteractiveSession(
  baseConfig: WinnowConfig,
  args: string[],
): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let config = { ...baseConfig };

  stdout.write(
    "Winnow session mode. Commands: :zh :raw :dual :quit | /backend /model /glossary /mode\n",
  );

  const persist = async () => {
    await saveProjectProfile(config);
  };

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
      await persist();
      continue;
    }

    if (line === ":raw") {
      config = { ...config, inputMode: "off", outputMode: "off", showOriginal: false, dualOutput: false };
      stdout.write("[winnow] mode switched to raw passthrough.\n");
      await persist();
      continue;
    }

    if (line === ":dual") {
      config = { ...config, outputMode: "en_to_zh", showOriginal: true, dualOutput: true };
      stdout.write("[winnow] mode switched to bilingual output.\n");
      await persist();
      continue;
    }

    if (line.startsWith("/backend ")) {
      const backend = line.replace("/backend ", "").trim();
      if (backend === "ollama" || backend === "deepseek_api") {
        config = { ...config, translatorBackend: backend };
        stdout.write(`[winnow] backend switched to ${backend}.\n`);
        await persist();
      } else {
        stdout.write("[winnow] invalid backend. Use ollama or deepseek_api.\n");
      }
      continue;
    }

    if (line.startsWith("/model ")) {
      const model = line.replace("/model ", "").trim();
      if (!model) {
        stdout.write("[winnow] model cannot be empty.\n");
        continue;
      }
      config = {
        ...config,
        ollamaTranslationModel: model,
        deepseekModel: model,
      };
      stdout.write(`[winnow] model set to ${model}.\n`);
      await persist();
      continue;
    }

    if (line.startsWith("/glossary ")) {
      const glossary = line.replace("/glossary ", "").trim();
      config = { ...config, translationGlossary: glossary };
      stdout.write("[winnow] glossary updated.\n");
      await persist();
      continue;
    }

    if (line.startsWith("/mode ")) {
      const mode = line.replace("/mode ", "").trim();
      if (mode === "zh") {
        config = { ...config, outputMode: "en_to_zh", showOriginal: false, dualOutput: false };
      } else if (mode === "raw") {
        config = { ...config, inputMode: "off", outputMode: "off", showOriginal: false, dualOutput: false };
      } else if (mode === "dual") {
        config = { ...config, outputMode: "en_to_zh", showOriginal: true, dualOutput: true };
      } else {
        stdout.write("[winnow] invalid mode. Use zh|raw|dual.\n");
        continue;
      }
      stdout.write(`[winnow] mode switched to ${mode}.\n`);
      await persist();
      continue;
    }

    await runWinnowSession({ config, args, stdinOverride: `${line}\n` });
  }

  rl.close();
}
