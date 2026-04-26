# Winnow

Winnow is an AI-first local IDE shell for serious builders.

It combines a curated set of AI workflows, terminal shortcuts, session continuity, and operational tooling into one place, so you can move from idea to patch to validation fast. Think of it as your personal high-leverage interface on top of `cursor-agent`: tuned for speed today, designed as a framework for more advanced AI experiments tomorrow.

## Vision

Most AI coding tools are either:
- great at chat but weak at execution, or
- powerful in the terminal but fragmented across too many commands and panes.

Winnow closes that gap:
- **IDE-like flow** with dashboard, agent workspace, docs pane, and terminal grid
- **Workflow density** through cherry-picked shortcuts and fast paths
- **Session continuity** so context is never lost between runs
- **Experiment surface** for evolving into advanced autonomous/agentic patterns

## Why users pick Winnow

- **One cockpit, fewer context switches**: monitor system, run agents, inspect transcripts, view docs, and manage terminals in a single UI.
- **Built for execution, not demos**: run real prompts, stream events, inspect status, and cancel/stop safely.
- **Fast resume loops**: pull prior sessions, reuse prompts, and continue with intent.
- **Opinionated where it matters**: practical defaults, focused controls, and quick actions that remove friction.
- **Extensible by design**: `.winnow` workspace data, local session artifacts, and modular CLI/UI code make experimentation straightforward.

## Core capabilities

- Dashboard with system status, usage metrics, recent runs, and project visibility
- Agent workspace with:
  - model preference
  - autonomy/continue toggles
  - resume session picker
  - streaming timeline + thinking trace + chat history
  - run/cancel/stop controls
- Main terminal grid with multiple panes and reconnect controls
- Session sync from local Winnow sessions and Cursor transcripts
- Docs panel for indexed Markdown/PDF browsing
- Workspace helpers: file/diff visibility and selective staging flows
- Token-protected HTTP/WebSocket access for shared/LAN usage

## Quickstart

### 1) Setup

```bash
npm run setup
```

If you prefer manual setup:

```bash
npm install
```

Use Node `>=20 <23` (Node 22 LTS recommended).

### 2) Run CLI

```bash
npm run dev -- --help
```

Useful checks:

```bash
npm run doctor
npm run status
```

### 3) Launch the IDE UI

```bash
npm run ui
```

Or directly:

```bash
npm run dev -- ui
```

Optional UI flags:

- `-- --port 3210`
- `-- --host 0.0.0.0`
- `-- --token ABC123` (access via `?token=ABC123`)
- `-- --no-open`
- `-- --pane1-cmd "ranger"`
- `-- --pane2-cmd "cursor-agent"`
- `-- --pane3-cmd "htop"`
- `-- --pane4-cmd "netwatch"`
- `-- --pane5-cmd "$SHELL"`

## Requirements

- `cursor-agent` installed and authenticated
- `ranger` on `PATH` (pane 1 default)
- `htop` on `PATH` (pane 3 default)
- `netwatch` on `PATH` (pane 4 default)

## Storage and project artifacts

- Local agent sessions: `.winnow/sessions`
- Runtime logs: `.winnow/logs` (JSONL)
- Cursor transcript sync default:
  `~/.cursor/projects/<workspace-id>/agent-transcripts`

## For builders and experimenters

Winnow is intentionally moving beyond “wrapper” territory. It is becoming:
- a personal AI IDE layer optimized for real software work,
- a repeatable workflow engine for rapid coding loops,
- and a foundation for advanced AI orchestration experiments.

If you want an environment that reflects how *you* actually build with AI, Winnow is that environment.
