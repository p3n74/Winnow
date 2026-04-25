# Winnow

Winnow is a terminal-first wrapper around `cursor-agent` that keeps Cursor account/model compatibility while adding optional Chinese translation via Ollama/DeepSeek, plus a local companion web UI.

## Why

- Keep full Cursor CLI workflows.
- Add Chinese input/output translation for productivity and language practice.
- Provide a clean path to an all-in-one dev environment without replacing Cursor.

## Quickstart

### 1) First-time setup (recommended)

```bash
npm run setup
```

This setup script automatically switches to Node 22 LTS when `nvm` is available, then installs dependencies.

### 2) Install dependencies (manual path)

```bash
npm install
```

If you manage Node manually, use Node `>=20 <23` (Node 22 LTS recommended).

### 3) Configure environment

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

### 4) Run in development

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
- `--ollama-base-url <ollama-base-url>`
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

`npm run ui` auto-switches to Node 22 via `nvm` when needed.
If PTY support is not available, it auto-rebuilds `node-pty` before launch.
You can also run it directly via CLI:

```bash
npm run dev -- ui
```

Optional flags:

- `-- --port 3210` set UI port
- `-- --host 0.0.0.0` bind for LAN access
- `-- --token ABC123` require URL token (`?token=ABC123`)
- `-- --no-open` keep browser closed
- `-- --pane1-cmd "ranger"` override pane 1 command
- `-- --pane2-cmd "cursor-agent"` override pane 2 command
- `-- --pane3-cmd "htop"` override pane 3 command
- `-- --pane4-cmd "netwatch"` override pane 4 command
- `-- --pane5-cmd "$SHELL"` override pane 5 command

UI capabilities:

- Dashboard view with status, logs, runtime profile controls, and git diff + selective staging
- Built-in "Cursor Agent" run panel (prompt + args + model preference + stream output)
- Session sync browser for Cursor transcripts and local Winnow runs (resume and prompt reuse helpers)
- Main grid layout: PTY terminals for panes `1/3/4/5`, with pane `2` as embedded agent workspace
- Per-pane reconnect button to respawn terminal process in the main grid
- Token protection enforced on both HTTP and WebSocket connections
- Main grid PTY terminals require supported Node runtime (`>=20 <23`)

Terminal app prerequisites:

- `ranger` installed and available on `PATH`
- `htop` installed and available on `PATH`
- `netwatch` available on `PATH`
- `cursor-agent` installed and authenticated

Session storage:

- Local UI-run agent sessions are stored in `.winnow/sessions`
- Cursor transcript sync defaults to `~/.cursor/projects/<workspace-id>/agent-transcripts`

## Notes

- If Ollama is unavailable, Winnow falls back to original output with a warning.
- Backend fallback chain is automatic: `deepseek_api -> ollama -> raw output`.
- Passthrough mode preserves stream behavior and exit codes.
- Translation mode uses sentence-chunk streaming for lower-latency output translation.
- Translation fidelity policy protects code blocks, inline code, flags, and path-like content from being translated.
- Structured session logs are written to `.winnow/logs` (JSONL) when enabled.
