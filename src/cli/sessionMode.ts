import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { WinnowConfig } from "../config/schema.js";
import { saveProjectProfile } from "../config/projectProfile.js";
import { runWinnowSession } from "../pipeline/session.js";
import { createCursorSession, listCursorSessions } from "../cursor/sessionUtils.js";

export async function runInteractiveSession(
  baseConfig: WinnowConfig,
  args: string[],
): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let config = { ...baseConfig };

  const persist = async () => {
    await saveProjectProfile(config);
  };

  // Ensure we have a session ID
  if (!config.sessionId) {
    const sessions = await listCursorSessions(1);
    if (sessions.length > 0) {
      config.sessionId = sessions[0].id;
      stdout.write(`[winnow] auto-resuming latest session: ${config.sessionId}\n`);
    } else {
      stdout.write("[winnow] no existing sessions found. Creating new one...\n");
      config.sessionId = await createCursorSession(config.cursorCommand);
      stdout.write(`[winnow] new session created: ${config.sessionId}\n`);
    }
    await persist();
  } else {
    stdout.write(`[winnow] resuming session: ${config.sessionId}\n`);
  }

  stdout.write(
    "Winnow session mode. Commands:\n" +
    "  :ls           List recent sessions\n" +
    "  :resume <id>  Resume specific session\n" +
    "  :new          Create new session\n" +
    "  :zh|:raw|:dual Mode toggles\n" +
    "  :quit         Exit session\n"
  );

  while (true) {
    const rawLine: string = await rl.question(`[${config.sessionId?.slice(0, 8)}] > `);
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line === ":quit" || line === ":q") {
      break;
    }

    if (line === ":ls") {
      const sessions = await listCursorSessions(10);
      stdout.write("\nRecent Cursor Sessions:\n");
      sessions.forEach((s, i) => {
        const currentMarker = s.id === config.sessionId ? "*" : " ";
        stdout.write(`${currentMarker} [${i}] ${s.id} (${s.updatedAt})\n    ${s.preview}\n`);
      });
      stdout.write("\nUse ':resume <id>' or ':resume <index>'\n");
      continue;
    }

    if (line.startsWith(":resume ")) {
      const target: string = line.replace(":resume ", "").trim();
      const sessions = await listCursorSessions(20);
      const index = parseInt(target, 10);
      let newId: string = target;
      
      if (!isNaN(index) && index >= 0 && index < sessions.length) {
        newId = sessions[index].id;
      }

      config.sessionId = newId;
      stdout.write(`[winnow] switched to session: ${config.sessionId}\n`);
      await persist();
      continue;
    }

    if (line === ":new") {
      config.sessionId = await createCursorSession(config.cursorCommand);
      stdout.write(`[winnow] new session created: ${config.sessionId}\n`);
      await persist();
      continue;
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
