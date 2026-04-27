#!/usr/bin/env node
import { Command } from "commander";
import { applyProfileDefaults } from "../config/defaults.js";
import { loadDotenvFromDisk } from "../config/dotenvFile.js";
import { loadConfigFromEnv, WinnowConfig } from "../config/schema.js";
import { applyProjectProfile, loadProjectProfile } from "../config/projectProfile.js";
import { runWinnowSession } from "../pipeline/session.js";
import { runInteractiveSession } from "./sessionMode.js";
import { runDoctor } from "./doctor.js";
import { runStatus } from "./status.js";
import { runUiServer } from "./ui.js";

type CliOptions = {
  zh?: boolean;
  noTranslate?: boolean;
  showOriginal?: boolean;
  dualOutput?: boolean;
  inputMode?: "off" | "zh_to_en";
  outputMode?: "off" | "en_to_zh";
  profile?: "learning_zh" | "engineering_exact";
  model?: string;
  translatorBackend?: "ollama" | "deepseek_api";
  deepseekModel?: string;
  deepseekBaseUrl?: string;
  ollamaBaseUrl?: string;
  translatorTimeoutMs?: number;
  translatorRetries?: number;
  cursorCommand?: string;
  session?: string;
  port?: number;
  open?: boolean;
  host?: string;
  token?: string;
  pane1Cmd?: string;
  pane2Cmd?: string;
  pane3Cmd?: string;
  pane4Cmd?: string;
  pane5Cmd?: string;
  shell?: boolean;
};

export function mergeConfig(base: WinnowConfig, options: CliOptions): WinnowConfig {
  let merged: WinnowConfig = { ...base };

  if (options.profile) {
    merged.profile = options.profile;
  }

  if (options.model) {
    merged.ollamaTranslationModel = options.model;
    merged.deepseekModel = options.model;
  }

  if (options.translatorBackend) {
    merged.translatorBackend = options.translatorBackend;
  }

  if (options.ollamaBaseUrl) {
    merged.ollamaBaseUrl = options.ollamaBaseUrl;
  }

  if (options.deepseekModel) {
    merged.deepseekModel = options.deepseekModel;
  }

  if (options.deepseekBaseUrl) {
    merged.deepseekBaseUrl = options.deepseekBaseUrl;
  }

  if (options.cursorCommand) {
    merged.cursorCommand = options.cursorCommand;
  }
  if (options.session) {
    merged.sessionId = options.session;
  }
  if (options.translatorTimeoutMs !== undefined) {
    merged.translatorTimeoutMs = options.translatorTimeoutMs;
  }
  if (options.translatorRetries !== undefined) {
    merged.translatorRetries = options.translatorRetries;
  }

  if (options.zh) {
    merged.outputMode = "en_to_zh";
  }

  if (options.noTranslate) {
    merged.inputMode = "off";
    merged.outputMode = "off";
  }

  if (options.inputMode) {
    merged.inputMode = options.inputMode;
  }

  if (options.outputMode) {
    merged.outputMode = options.outputMode;
  }

  if (options.showOriginal) {
    merged.showOriginal = true;
  }

  if (options.dualOutput) {
    merged.dualOutput = true;
    merged.showOriginal = true;
  }

  return applyProfileDefaults(merged);
}

export function buildProgram(): Command {
  const program = new Command();
  const getConfig = async (opts: CliOptions): Promise<WinnowConfig> => {
    loadDotenvFromDisk(process.cwd(), { override: false });
    const fromEnv = loadConfigFromEnv();
    const profile = await loadProjectProfile();
    const mergedBase = applyProjectProfile(fromEnv, profile);
    return mergeConfig(mergedBase, opts);
  };

  program
    .name("winnow")
    .description("Cursor CLI wrapper with optional Chinese translation via Ollama")
    .allowUnknownOption(true)
    .option("--zh", "translate assistant output to Chinese")
    .option("--no-translate", "disable all translation middleware")
    .option("--show-original", "show original Cursor output before translated output")
    .option("--dual-output", "show original and translated outputs")
    .option("--input-mode <mode>", "off|zh_to_en")
    .option("--output-mode <mode>", "off|en_to_zh")
    .option("--profile <profile>", "learning_zh|engineering_exact")
    .option("--translator-backend <backend>", "ollama|deepseek_api")
    .option("--model <model>", "ollama model for translation")
    .option("--deepseek-model <model>", "deepseek API model")
    .option("--deepseek-base-url <url>", "deepseek API base URL")
    .option("--ollama-base-url <url>", "ollama API base URL")
    .option("--session <id>", "resume specific cursor session ID")
    .option("--translator-timeout-ms <ms>", "translation request timeout in ms", Number)
    .option("--translator-retries <count>", "translation retry count", Number)
    .option("--cursor-command <cmd>", "cursor command to execute", "cursor-agent")
    .argument("[args...]", "arguments passed through to cursor-agent")
    .action(async (args: string[], opts: CliOptions) => {
      const config = await getConfig(opts);
      const exitCode = await runWinnowSession({ config, args });
      process.exit(exitCode);
    });

  program
    .command("session")
    .description("Interactive prompt session with runtime mode toggles")
    .allowUnknownOption(true)
    .option("--zh", "translate assistant output to Chinese")
    .option("--no-translate", "disable all translation middleware")
    .option("--show-original", "show original Cursor output before translated output")
    .option("--dual-output", "show original and translated outputs")
    .option("--input-mode <mode>", "off|zh_to_en")
    .option("--output-mode <mode>", "off|en_to_zh")
    .option("--profile <profile>", "learning_zh|engineering_exact")
    .option("--translator-backend <backend>", "ollama|deepseek_api")
    .option("--model <model>", "translation model")
    .option("--deepseek-model <model>", "deepseek API model")
    .option("--deepseek-base-url <url>", "deepseek API base URL")
    .option("--ollama-base-url <url>", "ollama API base URL")
    .option("--session <id>", "resume specific cursor session ID")
    .option("--translator-timeout-ms <ms>", "translation request timeout in ms", Number)
    .option("--translator-retries <count>", "translation retry count", Number)
    .option("--cursor-command <cmd>", "cursor command to execute", "cursor-agent")
    .argument("[args...]", "arguments passed through to cursor-agent")
    .action(async (args: string[], opts: CliOptions) => {
      const config = await getConfig(opts);
      await runInteractiveSession(config, args);
      process.exit(0);
    });

  program
    .command("doctor")
    .description("Run health checks for cursor + translator backend")
    .option("--translator-backend <backend>", "ollama|deepseek_api")
    .option("--deepseek-base-url <url>", "deepseek API base URL")
    .option("--deepseek-model <model>", "deepseek API model")
    .option("--ollama-base-url <url>", "ollama API base URL")
    .option("--session <id>", "resume specific cursor session ID")
    .option("--translator-timeout-ms <ms>", "translation request timeout in ms", Number)
    .option("--translator-retries <count>", "translation retry count", Number)
    .option("--cursor-command <cmd>", "cursor command to execute", "cursor-agent")
    .action(async (opts: CliOptions) => {
      const config = await getConfig(opts);
      const exitCode = await runDoctor(config);
      process.exit(exitCode);
    });

  program
    .command("status")
    .description("Show current runtime status and last session result")
    .option("--translator-backend <backend>", "ollama|deepseek_api")
    .option("--deepseek-model <model>", "deepseek API model")
    .option("--model <model>", "translation model")
    .option("--profile <profile>", "learning_zh|engineering_exact")
    .action(async (opts: CliOptions) => {
      const config = await getConfig(opts);
      const exitCode = await runStatus(config);
      process.exit(exitCode);
    });

  program
    .command("ui")
    .description("Start lightweight local web companion UI")
    .option("--port <port>", "UI server port", Number, 3210)
    .option("--host <host>", "UI bind host (use 0.0.0.0 for LAN access)", "127.0.0.1")
    .option("--token <token>", "6-char UI access token (required as ?token=...)")
    .option("--pane1-cmd <cmd>", "pane 1 command", "ranger")
    .option(
      "--pane2-cmd <cmd>",
      "pane 2 shell: optional command run before interactive shell (empty = plain shell only)",
      "",
    )
    .option("--pane3-cmd <cmd>", "pane 3 command", "htop")
    .option("--pane4-cmd <cmd>", "pane 4 command", "netwatch")
    .option(
      "--pane5-cmd <cmd>",
      "pane 5 command",
      process.platform === "win32" ? "" : process.env.SHELL || "zsh",
    )
    .option("--no-open", "do not auto-open browser")
    .option(
      "--shell",
      "open the UI in an embedded Electron window (no system browser tab); first run may download Electron via npx",
    )
    .action(async (opts: CliOptions) => {
      const config = await getConfig(opts);
      let token = opts.token?.trim();
      if (!token && opts.host === "0.0.0.0") {
        token = Math.random().toString(36).slice(2, 8).toUpperCase();
      }
      const desktopShell = Boolean(opts.shell);
      await runUiServer(config, {
        port: opts.port ?? 3210,
        openBrowser: desktopShell ? false : (opts.open ?? true),
        desktopShell,
        host: opts.host ?? "127.0.0.1",
        token,
        paneCommands: {
          "1": opts.pane1Cmd ?? "ranger",
          "2": opts.pane2Cmd ?? "",
          "3": opts.pane3Cmd ?? "htop",
          "4": opts.pane4Cmd ?? "netwatch",
          "5": opts.pane5Cmd ?? (process.platform === "win32" ? "" : (process.env.SHELL ?? "zsh")),
        },
      });
    });

  return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildProgram().parse(process.argv);
}
