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
- `WINNOW_TRANSLATOR_BACKEND` (`ollama` or `deepseek_api`)
- `WINNOW_TRANSLATOR_TIMEOUT_MS` (translation timeout per request)
- `WINNOW_TRANSLATOR_RETRIES` (translation retries on transient failure)
- `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com`)
- `DEEPSEEK_API_KEY` (required when backend is `deepseek_api`)
- `DEEPSEEK_MODEL` (for example `deepseek-v4-flash`)
- `WINNOW_TRANSLATION_GLOSSARY` (comma-separated term mapping, e.g. `PR:拉取请求`)
- `WINNOW_INPUT_MODE` (`off` or `zh_to_en`)
- `WINNOW_OUTPUT_MODE` (`off` or `en_to_zh`)
- `WINNOW_PROFILE` (`learning_zh` or `engineering_exact`)
- `WINNOW_LOGS_ENABLED` (`true`/`false`)
- `WINNOW_LOGS_DIR` (default `.winnow/logs`)

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
- `--translator-backend ollama|deepseek_api`
- `--model <ollama-model>`
- `--deepseek-model <deepseek-model>`
- `--deepseek-base-url <deepseek-base-url>`
- `--translator-timeout-ms <ms>`
- `--translator-retries <count>`

Interactive mode with runtime toggles:

```bash
npm run dev -- session --zh <cursor-agent-args>
```

Session commands:

- `:zh` Chinese output mode
- `:raw` passthrough mode (no translation)
- `:dual` bilingual output (original + Chinese)
- `:quit` exit session
- `/backend <ollama|deepseek_api>` switch translator backend and save project profile
- `/model <name>` update translation model and save project profile
- `/glossary <csv>` update glossary and save project profile
- `/mode <zh|raw|dual>` switch mode and save project profile

Project profile persistence:

- Session preference changes are saved in `.winnow/profile.json`.
- Winnow auto-loads this profile in the current repository for future runs.

Health checks:

```bash
npm run doctor
```

Status:

```bash
npm run status
```

Lightweight UI companion:

```bash
npm run ui
```

Optional flags:

- `-- --port 3210` set UI port
- `-- --no-open` keep browser closed

UI capabilities:

- Live status dashboard (backend/model/mode/retries/log state)
- Quick controls for backend/model/glossary/mode
- Recent session logs viewer
- Saves changes into `.winnow/profile.json`
- Agent console that runs `cursor-agent` directly (translation disabled for runs)
- Model preference toggle for Cursor-native selection (`auto` or `composer`)
- Real-time agent output streaming in UI via Server-Sent Events (with polling fallback)
- Workspace changes panel with file list, full `git diff`, and stage-selected action

## Notes

- If Ollama is unavailable, Winnow falls back to original output with a warning.
- Backend fallback chain is automatic: `deepseek_api -> ollama -> raw output`.
- Passthrough mode preserves stream behavior and exit codes.
- Translation mode uses sentence-chunk streaming for lower-latency output translation.
- Translation fidelity policy protects code blocks, inline code, flags, and path-like content from being translated.
- Structured session logs are written to `.winnow/logs` (JSONL) when enabled.
