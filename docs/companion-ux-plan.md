# Companion UX plan

Four workstreams for the Agent companion + Main Grid. Land **one commit per ID**. Test on the worktree branch; cherry-pick onto `feat/companion-ux`. **Do not push or merge to main unless the user asks.**

**Integration branch:** `feat/companion-ux`  
**Base:** `fix/audit-i1-graph-load` (`6d31b11`)

Leave `.winnow/*`, screenshots, and unrelated untracked files out of every commit.

## Rules (every subagent)

1. **One ID per commit.** No drive-by refactors, no extra features from other IDs.
2. **Named files only.** `git add path1 path2`. Never `git add .` or `git add -A`.
3. Stay inside **Allowed files**. If you need another file, stop and report.
4. Commit via HEREDOC. Hooks on. No `--no-verify`, no amend, no force, no push, no merge.
5. **Do not migrate to `@cursor/sdk`.** Keep `cursor-agent` spawn + stdin + NDJSON.
6. `npm test` before commit. Add a focused test when the behavior is unit-testable.
7. UI changes: keep the existing two-tone dark theme (cyan on near-black). Do not restyle the whole app.
8. Report: branch, SHA, files, test result, residual risk.

## Cherry-pick order

| # | ID | Branch | Commit message | Allowed files |
| --- | --- | --- | --- | --- |
| 1 | P1 | `feat/companion-p1-collapse` | `feat(ui): collapse agent controls to free conversation space` | `src/cli/agentWindowHtml.ts`, tests |
| 2 | P2 | `feat/companion-p2-trace-tab` | `feat(ui): move tool/status trace into pane 1 as a tab` | `src/cli/ui/mainGridHtml.ts`, `src/cli/agentWindowHtml.ts`, `src/cli/ui.ts`, tests |
| 3 | P3 | `feat/companion-p3-attachments` | `feat(ui): attach screenshots via local files in the prompt` | `src/cli/ui.ts`, `src/cli/agentWindowHtml.ts`, `src/cursor/attachments.ts`, tests |
| 4 | P4 | `feat/companion-p4-subagents` | `feat(ui): surface Cursor subagents in the companion` | `src/cli/ui.ts`, `src/cli/agentWindowHtml.ts`, `src/cursor/subagents.ts`, tests |

---

## P1 — Collapse companion controls

### Vision
The Agent iframe (`/agent?embed=1` in pane 2) wastes vertical space on Mode / Model / args / Resume / Plan / Cwd / quickbar while a run is in progress. Collapse those rows so **Conversation + composer** get the height. Keep a compact bar: account line, **Run**, session status, and a **Controls** toggle.

### Goals
- Default **expanded** for first-time setup; persist collapsed state in `localStorage` (`winnow.agentControlsCollapsed`).
- Toggle control labeled **Controls** (or a chevron) on the compact bar. Expanded = all current rows. Collapsed = hide Mode through quickbar (and the cwd/transcripts hints). **Do not hide** login line, conversation, composer, Run in the composer footer.
- Collapsed bar still shows: model name (read-only text), Run, status badge.
- Keyboard: keep ⌘↵ Run while collapsed.
- Do not remove continue-session / resume behavior; only hide the widgets.

### Tests
- `tests/agentWindowHtml.test.ts` (or extend an existing HTML contract test): `buildAgentWindowPageHtml()` contains `winnow.agentControlsCollapsed`, a `data-agent-controls` wrapper, and a toggle that does not remove `#agentPrompt` / `[data-agent-run]`.
- `npm test`.

### Residual
Dashboard `/` Agent tab may keep full controls (out of scope unless trivial copy). Prefer agent window only.

---

## P2 — Tool/status trace tab on pane 1

### Vision
Pane 1 is currently a single ranger PTY (`1 File Browser`). Pane 2 already has **Agent | Shell | Docs | Graph | Plans | Processes** tabs. Add the same tab pattern on pane 1: **Browser | Trace**. Trace is the tool/status log currently in `#agentThinking` (“Thinking trace” copy is misleading; print mode has no thinking events).

### Goals
- Pane 1 header tabs: **Browser** (ranger PTY, default) and **Trace**.
- Trace view: full-pane `<pre>` (or scrollable log) of the **active or latest** agent session’s status/tool lines.
- Live updates: EventSource `/api/agent/:id/stream` `timeline` / status events, same payload the agent iframe already consumes. Add `GET /api/agent/active` (or reuse session list) so pane 1 can attach without the iframe.
- Shrink or remove the in-iframe `#agentThinking` block so conversation gets space. Keep a one-line status in the agent chrome.
- Reconnect stays on the Browser tab only (same idea as pane 2 Shell reconnect).
- Toolbar chip: `1 ranger · trace`.

### Tests
- HTML contract: `buildMainTerminalHtml()` includes `data-pane1-tab="browser"` and `data-pane1-tab="trace"`.
- If you add `/api/agent/active`, unit-test the helper that picks the latest running session else latest ended.
- `npm test`.

### Residual
Trace is not Cursor “thinking” tokens; it is Winnow’s tool/status timeline.

---

## P3 — Screenshot / image attachments

### Official CLI behavior
Cursor headless docs: **no attachment flag**. Images are passed by putting **file paths in the prompt**; the agent reads them with tools. SDK image blobs are a different product — do not use `@cursor/sdk`.

### Goals
- Composer: paperclip + paste (⌘V image) + drag-drop onto the textarea.
- Store files under `<workspace>/.winnow/attachments/<uuid>.<ext>` (png/jpeg/webp/gif only). Cap ~8 MB each, max 8 files per send.
- `POST /api/attachments` `{ mime, dataBase64 }` → `{ ok, id, relPath, absPath }`. Sandbox writes under `.winnow/attachments`.
- On Run, append a prompt block:

```
## Attached files
Read these paths with your file tools (screenshots for this task):
- /abs/path/to/uuid.png
```

- Show thumbnails + remove. Do not send raw base64 to `cursor-agent`.
- GUID is the filename stem.

### Tests
- `tests/attachments.test.ts`: reject path escape, reject non-image mime, write+read roundtrip with a tiny PNG base64, prompt builder includes abs paths.
- `npm test`.

---

## P4 — Subagents in Winnow

### Official behavior
Cursor subagents: `.cursor/agents/*.md` (YAML frontmatter `name`, `description`, `model`, `readonly`, `is_background`). Built-ins: explore, bash, browser. Parent CLI may emit nested work in stream-json. Forum: CLI Task-tool delegation has been flaky; Winnow must **observe** the stream, not pretend to be the IDE Task tool.

### Goals
1. **Discover:** `GET /api/cursor/subagents` lists project `.cursor/agents/*.md` (+ optional `~/.cursor/agents`) with name/description/model.
2. **Observe:** while a run streams, parse NDJSON for nested agent/subagent/task events (unknown fields ignored). Record `{ id, name, status, summary }` on the session.
3. **UI:** compact **Subagents** list in the companion (visible even when P1 controls are collapsed): defined agents + live rows for the current run.
4. **Do not** spawn extra `cursor-agent` children in this commit. Native Cursor subagents stay inside the parent process. Document that in a one-line UI hint.
5. Optional later (out of scope): Winnow-spawned parallel runs via existing `/api/agent/start`.

### Tests
- `tests/subagents.test.ts`: parse a sample `.md` frontmatter; parse a fixture stream event into a live row; ignore unknown types.
- `npm test`.

---

## Integration

```bash
# after each worktree:
git cherry-pick <sha>
npm test
```

Manual: `npm run ui -- --shell` — collapse controls, pane 1 Trace tab during a run, attach a PNG and confirm the prompt contains the path, subagents list shows `.cursor/agents` files if present.
