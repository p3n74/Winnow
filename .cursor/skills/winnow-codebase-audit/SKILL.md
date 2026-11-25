---
name: winnow-codebase-audit
description: >-
  Audits the Winnow codebase for UX errors, functionality gaps, internal HTTP
  API contract mismatches, inefficiencies, and incorrect Cursor Agent CLI /
  stream-json usage. Use when the user asks to audit Winnow, review Cursor API
  compatibility, find UX bugs, map functionality gaps, or check cursor-agent
  spawn/resume/model/stream handling.
---

# Winnow codebase audit

Read [cursor-cli-traps.md](cursor-cli-traps.md) before judging Cursor usage.

This is an **evidence-only audit**. Do not implement fixes unless the user asks.
Cite file paths and line ranges. Prefer a finding with a quote over a guess.

Winnow is a local coding cockpit that wraps **`cursor-agent`** (Cursor Agent CLI), not `@cursor/sdk` and not the Cloud Agents REST API. Judge CLI usage against current Cursor CLI docs, and judge Winnow's own `/api/*` contract separately.

## When invoked

1. Fetch current Cursor CLI docs (do not rely on memory):
   - https://cursor.com/docs/cli/reference/parameters
   - https://cursor.com/docs/cli/reference/output-format
   - https://cursor.com/docs/cli/using
   - https://cursor.com/docs/cli/overview
2. Inventory Winnow's Cursor and HTTP surfaces (see Scope).
3. Diff implementation against those docs and against the UI that consumes each API.
4. Write the report in the format below. Rank Cursor incompatibilities first.

## Scope

Read and cross-check these layers. Skip generated artifacts (`.winnow/`, `dist/`, screenshots, `node_modules`).

| Layer | Primary files |
| --- | --- |
| Cursor spawn / stream | `src/cli/ui.ts`, `src/cursor/runCursor.ts`, `src/pipeline/session.ts` |
| Resume / transcripts | `src/cursor/sessionUtils.ts`, `src/cli/ui/cursorSessionRead.ts`, `src/cli/sessionMode.ts` |
| Agent UI (duplicated) | `src/cli/agentWindowHtml.ts`, `src/cli/ui/dashboardHtml.ts` |
| Main grid / workspace | `src/cli/ui/mainGridHtml.ts` |
| HTTP server | `src/cli/ui.ts` (`/api/*` handlers) |
| CLI passthrough | `src/cli/index.ts`, `src/cli/doctor.ts`, `src/cli/status.ts` |
| Graph / plans / processes | `src/graph/*`, `src/data/planStore.ts`, `src/data/processManager.ts` |
| Tests | `tests/cursor.test.ts` and related |

## Priority order

Score every finding. Cursor misuse outranks polish.

1. **Cursor CLI / stream-json incompatibilities** — wrong flags, silent resume fallback, duplicate/missing stream events, unused `session_id`, model list vs `--model`, headless flags (`--print`, `--trust`, `--workspace`).
2. **Inefficiencies** — extra `cursor-agent` processes, prompt bloat (graph/plan/history preambles), N+1 `/api` calls, loading full graph into the browser, missing cancel/dispose.
3. **Internal API contract gaps** — UI `fetch` vs `ui.ts` routes: missing `withToken`, wrong method, ignored `ok`/`error`, routes with no client, clients with no route, duplicated agent UIs that drifted.
4. **Functionality gaps** — README/docs/UI copy promises a control that is missing, stubbed, or only works on one of dashboard vs agent window vs main grid.
5. **UX errors** — misleading copy, silent failures, loading/empty/error states, stop/cancel that does not stop, resume picker mixing Winnow-local ids with Cursor chat ids.

## Cursor audit (mandatory)

Winnow's supported integration is **`cursor-agent` via spawn + stdin prompt + NDJSON stdout**. Check at least:

- Spawn flags in `ensureExecutionArgs` / `getEffectiveArgs` vs current CLI parameters.
- `--resume` only with Cursor chat UUIDs from `system.init` / `create-chat` / transcript filenames — never Winnow's `<timestamp>-<rand>` ids.
- Whether `system.init.session_id` is captured and reused on the next run.
- `stream-json` + `--stream-partial-output` filtering: skip duplicate assistant flushes (`model_call_id` present, or `timestamp_ms` absent). See traps file.
- `--model` id vs the friendly label in `system.init.model`.
- `cursor-agent models` vs `--list-models`.
- Prompt delivery: stdin vs argv; `--print` required for non-interactive.
- Headless: `--trust`, `--workspace`, `--force`/`--yolo`, `--sandbox`.
- Dead helpers: `createCursorSession` used in CLI session mode but maybe not in the UI start path.
- CLI passthrough (`src/pipeline/session.ts`) adding `--print`/`--resume` without `stream-json` when the UI path does.

Do **not** recommend migrating to `@cursor/sdk` unless a specific CLI limitation is blocking a real Winnow feature. If you mention SDK/REST, label it as a future option, not a defect.

## Internal HTTP audit

Build a route inventory from `src/cli/ui.ts` (`url.pathname === "/api/..."`). For each route, find every client call in the three HTML modules.

Flag:

- `fetch("/api/...")` without `withToken(...)` (LAN token gate).
- Client calls to routes that do not exist, or routes with no UI.
- `EventSource` vs `fetch` mismatch on `/api/agent/:id/stream`.
- Duplicate agent start/stop/resume logic in `dashboardHtml.ts` and `agentWindowHtml.ts` that diverged.
- Graph payloads (`/api/graph/nodes?limit=2000`, edges `4000`) that will stall the UI.

## UX / gap audit

Walk the product surface described in `README.md`: dashboard, main grid, agent workspace, docs, graph, plans, processes, files, settings.

For each screen, note broken states: empty, loading, error, unauthorized, running, cancelled. A control that looks clickable but no-ops is a UX error.

Do not file "add dark mode" style taste notes. Only file UX that causes wrong action, lost data, or confusion about agent state.

## Report format

```markdown
# Winnow audit

## Executive summary
One paragraph: worst Cursor issues, then the next most expensive class of bugs.

## Cursor CLI / API
### C1. <title>
- Severity: Critical | High | Medium | Low
- Evidence: `path:lines`
- Current behavior: …
- Correct CLI behavior (cite fetched docs): …
- Impact: …
- Fix sketch: one or two sentences, no patch unless asked

## Inefficiencies
### I1. …

## Internal API contract
### A1. …

## Functionality gaps
### G1. …
- Promised by: README / UI copy / control label
- Actual: …

## UX errors
### U1. …

## What looks correct
Short list so the next pass does not re-litigate it.

## Suggested fix order
Numbered, Cursor-first, smallest reversible change first.
```

If a category has no findings, write `None found` with the files you checked — do not invent issues.

## Rules

- Quote current Cursor docs in findings. If docs and Winnow disagree, that is a finding.
- One issue per item. Do not bundle "resume is wrong and also the graph is slow".
- No drive-by refactors, no new features, no README rewrites during the audit.
- If you cannot verify (needs a live `cursor-agent` binary), mark **Unverified** and say what command would confirm it.
