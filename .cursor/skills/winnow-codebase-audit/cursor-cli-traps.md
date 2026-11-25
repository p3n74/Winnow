# Cursor CLI traps for Winnow audits

Source of truth is the live docs, not this file. Re-fetch before scoring findings:

- https://cursor.com/docs/cli/reference/parameters
- https://cursor.com/docs/cli/reference/output-format

Winnow talks to Cursor through the **Agent CLI** (`cursor-agent` / `agent`), spawned as a child process. It does not use `@cursor/sdk` or `/v1/agents`.

## Integration shape Winnow uses

UI path (`src/cli/ui.ts` `startAgentSession`):

1. `spawn(cursorExe, args, { cwd: uiWorkspace.dir, stdio: pipe })`
2. Write the prompt on stdin, then `stdin.end()`
3. Parse stdout as NDJSON (`--print --output-format stream-json --stream-partial-output`)
4. Kill the child on stop

CLI path (`src/pipeline/session.ts`):

1. Forward argv to `cursor-agent`
2. Optionally inject `--resume` and `--print`
3. Does **not** currently force `stream-json`

## Flags Winnow already sends (UI)

| Flag | Why |
| --- | --- |
| `--print` | Non-interactive / scripted run |
| `--output-format stream-json` | NDJSON events |
| `--stream-partial-output` | Character-level assistant deltas |
| `--model <id>` | When preference is not `default` |
| `--resume <uuid>` | Only if the id looks like a Cursor chat UUID |
| `--force` + `--sandbox disabled` | Autonomy mode |

## Flags / commands to check for absence or misuse

| CLI surface | Typical Winnow implication |
| --- | --- |
| `--resume [chatId]` | Unknown ids silently fall back to Auto. Winnow local ids (`<timestamp>-<rand>`) must never be passed. |
| `--continue` / `--resume=-1` | Resume latest Cursor chat. UI may reimplement this badly with transcript files. |
| `create-chat` | Returns a real chat id. Used in `src/cli/sessionMode.ts` via `createCursorSession`; UI start path may skip it and invent a Winnow id instead. |
| `system.init.session_id` | Canonical id for the live run. If Winnow does not persist this, the next `--resume` cannot work. |
| `--workspace <dir>` | CLI-native workspace. Winnow uses spawn `cwd` instead — confirm that is still equivalent. |
| `--trust` | Headless trust; missing this can hang on workspace prompts. |
| `--mode plan` / `--mode ask` / `--plan` | Not exposed in the UI. Gap only if the UI copy implies plan/ask modes. |
| `--list-models` vs `agent models` | Winnow parses `cursor-agent models` as `<id> - <label>`. Confirm the command and line format still match. |
| `--api-key` / `CURSOR_API_KEY` | CLI auth. Winnow relies on the logged-in CLI; Settings env editing is a separate path. |
| `--yolo` | Alias of `--force`. Already treated as equivalent in `ensureExecutionArgs`. |

## stream-json consumer rules

Docs: `--stream-partial-output` emits **three** kinds of `assistant` events. Only the first has new text.

| `timestamp_ms` | `model_call_id` | Action |
| --- | --- | --- |
| Present | Absent | **Append** `message.content[].text` |
| Present | Present | **Skip** (buffered flush before a tool call, duplicate) |
| Absent | Absent | **Skip** (final flush at end of turn, duplicate) |

Winnow currently skips when `model_call_id` is set. Audit whether it also skips the final flush (`timestamp_ms` absent). Double-printed assistant text is a Cursor-API misuse finding.

Other stream facts from the docs:

- `thinking` events are **suppressed in print mode**. UI copy that promises a thinking timeline from `cursor-agent --print` is a functionality/UX gap, not a parser bug.
- Terminal event is `type: "result"`, `subtype: "success"`. Failure may exit non-zero **without** a terminal JSON event; stderr is the error channel.
- `system.init.model` is a **display name**, not necessarily the `--model` id. Comparing them naively produces false "wrong model" kills.
- Ignore unknown fields; the stream is allowed to grow.

## Resume id rules

Cursor chat ids in docs/examples are UUIDs (`c6b62c6f-7ead-4fd6-9922-e952131177ff`).

Winnow has two id spaces:

- **Cursor chat id** — from `create-chat`, `system.init.session_id`, or `~/.cursor/projects/<workspace-id>/agent-transcripts/*.jsonl`
- **Winnow local id** — `${Date.now()}-${random}` stored under `.winnow/sessions`

Passing a Winnow local id to `--resume` is a **Critical** finding if it still happens on any path (raw args, resume picker, dashboard vs agent window). Prefacing local history into the prompt is a workaround, not native resume — label it as a gap if the UI says "resume".

## Do not score these as defects by default

- Not using `@cursor/sdk`. Winnow is a CLI wrapper by design.
- Not using Cloud Agents REST `/v1/agents`. Out of scope unless the UI claims cloud runs.
- Translation (`ollama` / DeepSeek) wrapping stdout. Separate from Cursor compatibility unless it corrupts NDJSON.

## Quick verification commands (mark Unverified if not run)

```bash
cursor-agent --help
cursor-agent models
cursor-agent create-chat
# Confirm stream-json event shape on a trivial print run:
# printf 'reply with the word ping\n' | cursor-agent --print --output-format stream-json --stream-partial-output
```
