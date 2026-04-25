# Winnow v2

Winnow v2 expands the original terminal-first workflow with stronger Cursor session continuity and a richer companion web UI for agent runs, monitoring, and resume flows.

## What Changed in v2

### 1) Session-First Workflow

- Added persistent `sessionId` support to config and runtime execution.
- Added CLI flag: `--session <id>` to resume a specific Cursor session.
- Interactive session mode now auto-resumes the latest session when available, or creates a new one if none exist.
- New interactive commands:
  - `:ls` list recent sessions
  - `:resume <id|index>` switch to an existing session
  - `:new` create a new session
- Prompt now displays active session context in the interactive loop.

## 2) Cursor Session Utilities

- Introduced shared session utilities in `src/cursor/sessionUtils.ts`.
- Added transcript directory helpers:
  - default path resolution from workspace
  - env override support via `WINNOW_AGENT_TRANSCRIPTS_DIR`
- Added `createCursorSession()` using `cursor-agent create-chat`.
- Added `listCursorSessions()` to scan and summarize available transcript sessions.

## 3) UI and Agent Workspace Upgrade

- Main UI shifted from a simple console panel to a richer agent workspace.
- Added standalone agent page route: `/agent`.
- Added an embedded agent window layout inspired by editor workbench UX (title bar, session sidebar, composer area).
- Added run controls:
  - model preference includes `default`, `auto`, `composer`
  - autonomy toggle
  - continue-session toggle
  - explicit resume-session picker
- Added session-aware run behavior:
  - auto-injects `--resume <id>` when continuing
  - enforces `--print` on resumed runs
  - applies autonomy args (`--force`, `--sandbox disabled`) when enabled
- Added timeline event streaming (`timeline`) to represent structured run events in UI.
- Added chat-style history rendering for user/assistant/stderr/status/tool events.
- Added lightweight runtime metrics (token estimates, chunk count, elapsed time).
- Added thinking-trace extraction from streamed output.

## 4) Main Grid UX Refresh

- Updated visual style for the main terminal grid.
- Added top toolbar and clearer pane labeling.
- Kept PTY-backed panes and reconnect controls.
- Changed embedded Cursor pane target to the new `/agent` route.

## 5) Local Session Persistence Improvements

- Local session records now store structured `events` timeline, not only plain output fields.
- Session replay can reconstruct messages from saved timeline events.
- SSE reconnect path can backfill prior events for better continuity after stream interruption.

## 6) Status Output Enhancements

- Status snapshot now includes active `sessionId`.
- CLI status output now reports:
  - `session_id` (or `none`)
  - `last_event` (renamed from `last_session` output label)

## 7) README and CLI Docs Updates

- Core README now reflects:
  - DeepSeek/Ollama translation wording updates
  - explicit `--ollama-base-url` and `--session` flag visibility
  - refreshed UI capability list
  - new local and Cursor transcript session storage locations
  - direct run reminder for `npm run dev -- ui`

## Migration Notes (v1 -> v2)

- Existing workflows continue to work without a session id.
- To opt into deterministic session continuation:
  1. Use `--session <id>` in CLI, or
  2. Use interactive `:resume`, or
  3. Choose a session in the UI and run with continue mode.
- If transcript discovery returns no sessions, v2 creates a new chat session automatically.

## Quick Start (v2 behavior)

```bash
# Start UI
npm run dev -- ui

# Start CLI session mode with explicit session
npm run dev -- session --session <cursor-session-id>
```

v2 focuses on continuity: keep context between runs, resume safely, and inspect agent execution with better visibility.
