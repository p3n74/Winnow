# Winnow Architecture

Winnow is a thin wrapper over `cursor-agent`, plus a local companion UI.

## Pipeline

1. Parse CLI flags and environment into a `WinnowConfig`.
2. If translation is off, stream directly to `cursor-agent` (passthrough mode).
3. If translation is on:
   - translate piped stdin from Chinese to English (optional),
   - execute `cursor-agent`,
   - translate stdout from English to Chinese (optional),
   - preserve stderr as-is.

## Companion UI

`winnow ui` serves the dashboard, main grid (PTY WebSockets), agent workspace, docs, graph, and plans from the **same machine** that holds the workspace. Cursor remains the source of truth for agent auth and quotas.

- Default bind is loopback (`127.0.0.1`). `--host 0.0.0.0` is LAN. `--remote` is the network-facing mode (non-loopback bind, access token unless `--no-token`, no auto-open browser).
- When a token is set, clients present it as `?token=`, `Authorization: Bearer`, or the `winnow_ui` cookie. `GET /api/health` stays public for probes.
- A later public site (for example Coolify on a VPS) should **reverse-proxy** this UI (HTTP + WebSocket `/ws/main/*` + `/ws/preview/chrome` + SSE + `/__preview/:port`). That site is a separate service; Winnow does not terminate TLS or dial out to the VPS.

See [remote-access.md](./remote-access.md) for the operator and proxy contract.

## Constraints

- Cursor remains the source of truth for auth, model access, and quotas.
- Ollama is used only for translation and output localization.
- Commands, paths, code blocks, stack traces, and JSON must be preserved.

## Future Extensions

- Streaming chunk translation for lower latency.
- Persistent session replay and glossary-based terminology controls.
