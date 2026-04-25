# Winnow

Winnow is a terminal-first wrapper around `cursor-agent` that keeps Cursor account/model compatibility while adding optional Chinese translation via Ollama.

## Why

- Keep full Cursor CLI workflows.
- Add Chinese input/output translation for productivity and language practice.
- Provide a clean path to an all-in-one dev environment without replacing Cursor.

## Quickstart

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment

```bash
cp .env.example .env
```

Edit `.env` values if needed:

- `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`)
- `OLLAMA_TRANSLATION_MODEL` (for example `deepseek-v3`)
- `WINNOW_INPUT_MODE` (`off` or `zh_to_en`)
- `WINNOW_OUTPUT_MODE` (`off` or `en_to_zh`)
- `WINNOW_PROFILE` (`learning_zh` or `engineering_exact`)

### 3) Run in development

```bash
npm run dev -- --help
```

## Usage

Pass all regular `cursor-agent` arguments through Winnow:

```bash
npm run dev -- --zh <cursor-agent-args>
```

Common flags:

- `--zh`: output Chinese translation.
- `--no-translate`: disable translation completely.
- `--input-mode off|zh_to_en`
- `--output-mode off|en_to_zh`
- `--show-original`
- `--dual-output`
- `--profile learning_zh|engineering_exact`
- `--model <ollama-model>`

## Notes

- If Ollama is unavailable, Winnow falls back to original output with a warning.
- Passthrough mode preserves stream behavior and exit codes.
- Translation mode currently captures stdout then translates (non-streamed).
