# Winnow Architecture

Winnow is a thin wrapper over `cursor-agent`.

## Pipeline

1. Parse CLI flags and environment into a `WinnowConfig`.
2. If translation is off, stream directly to `cursor-agent` (passthrough mode).
3. If translation is on:
   - translate piped stdin from Chinese to English (optional),
   - execute `cursor-agent`,
   - translate stdout from English to Chinese (optional),
   - preserve stderr as-is.

## Constraints

- Cursor remains the source of truth for auth, model access, and quotas.
- Ollama is used only for translation and output localization.
- Commands, paths, code blocks, stack traces, and JSON must be preserved.

## Future Extensions

- Streaming chunk translation for lower latency.
- Optional browser UI via `winnow ui` reusing the same backend session.
- Persistent session replay and glossary-based terminology controls.
