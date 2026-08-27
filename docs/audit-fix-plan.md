# Audit fix plan

Playbook for landing the 2026-08-27 Winnow codebase audit as **one commit per finding**. Test on this branch; merge only after the full queue is green.

**Integration branch:** `fix/audit-findings`  
**Base:** `feat/plans-github-sync` (`f7bd6c6`)  
**Do not merge to `main` until the user says so.**  
**Do not push unless the user asks.**

## Recoverable snapshots

| What | Where |
| --- | --- |
| Dirty tree before this work | `refs/backup/pre-audit-fix-*` |
| Stashed WIP (modelOptions + session source labels) | `git stash list` → `wip: session source labels and modelOptions (pre-audit-fixes)` |

Restore that stash onto `feat/plans-github-sync` later if those changes are still wanted. Do not mix them into audit commits.

Leave `.winnow/*`, screenshots, and unrelated untracked files out of every commit.

## Rules (every subagent)

1. **One finding per commit.** No drive-by refactors, no formatting-only diffs, no extra features.
2. **Named files only.** `git add path1 path2`. Never `git add .` or `git add -A`.
3. **Allowed files** are listed per commit below. If you need another file, stop and report; do not expand scope.
4. **Commit message** via HEREDOC, `fix|perf|docs|chore` + scope, matching repo style (`fix(ui): …`).
5. **Hooks on.** No `--no-verify`. If a hook fails, fix and make a **new** commit; do not amend unless the user asked.
6. **Tests:** `npm test` for the change. Add or update a focused test when the behavior is unit-testable (`tests/cursor.test.ts` or a new `tests/*.test.ts`). If the change is HTML-in-string only, say so and still run the suite.
7. **No push, no merge, no force, no reset --hard, no config edits.**
8. **Do not migrate to `@cursor/sdk`.** Keep `cursor-agent` spawn + stdin + NDJSON.
9. **Cherry-pick friendly:** smallest hunk that fixes the finding. Do not rewrite surrounding functions unless required.
10. When done, report: branch name, commit SHA, files, test result, residual risk.

## Commit queue (cherry-pick this order)

Apply onto `fix/audit-findings` in this order even if worktrees finish out of order. Later commits may depend on earlier ones (`C1` before `I2` and `C5`).

| # | ID | Branch | Commit message | Allowed files |
| --- | --- | --- | --- | --- |
| 1 | C2 | `fix/audit-c2-stream-json` | `fix(ui): skip duplicate stream-json assistant flushes` | `src/cli/ui.ts`, tests if added |
| 2 | C3 | `fix/audit-c3-headless-trust` | `fix(ui): pass --trust and --approve-mcps in print mode` | `src/cli/ui.ts`, tests if added |
| 3 | U1 | `fix/audit-u1-stop-flush` | `fix(ui): flush agent stdout on close and escalate stop` | `src/cli/ui.ts`, tests if added |
| 4 | I3 | `fix/audit-i3-models-cache` | `perf(ui): cache cursor-agent models list with TTL` | `src/cli/ui.ts`, tests if added |
| 5 | U2 | `fix/audit-u2-model-mismatch` | `fix(ui): do not kill runs when model label map misses` | `src/cli/ui.ts`, tests if added |
| 6 | C1 | `fix/audit-c1-session-id` | `fix(ui): persist cursor-agent session_id for native resume` | `src/cli/ui.ts`, `src/cli/ui/types.ts`, `src/cursor/sessionUtils.ts`, tests |
| 7 | C5 | `fix/audit-c5-create-chat` | `fix(ui): create Cursor chat ids before first UI spawn` | `src/cli/ui.ts`, `src/cli/sessionMode.ts`, `src/cursor/sessionUtils.ts`, tests |
| 8 | C4 | `fix/audit-c4-resume-args` | `fix(ui): stop stripping valid --resume and fix dashboard regex` | `src/cli/ui.ts`, `src/cli/agentWindowHtml.ts`, `src/cli/ui/dashboardHtml.ts` |
| 9 | G2 | `fix/audit-g2-continue-mode` | `fix(ui): honor resume picker without a hidden continue checkbox` | `src/cli/agentWindowHtml.ts`, `src/cli/ui/dashboardHtml.ts` |
| 10 | I2 | `fix/audit-i2-preamble` | `perf(agent): shrink graph/plan seed and skip history on native resume` | `src/cli/ui.ts`, `src/graph/agentGraphSeed.ts` |
| 11 | A1 | `fix/audit-a1-github-token` | `fix(ui): send LAN token on plan GitHub fetches` | `src/cli/ui/mainGridHtml.ts` |
| 12 | I1 | `fix/audit-i1-graph-load` | `perf(graph): load neighborhood instead of full graph dump` | `src/cli/ui/mainGridHtml.ts`, graph server files only if required |
| 13 | A2 | `fix/audit-a2-dashboard-parity` | `fix(ui): align dashboard agent start payload with /agent` | `src/cli/ui/dashboardHtml.ts` |
| 14 | G1 | `fix/audit-g1-thinking-copy` | `docs(ui): stop calling tool traces a thinking timeline` | `README.md`, `src/cli/agentWindowHtml.ts`, `src/cli/ui/dashboardHtml.ts` |
| 15 | G3 | `fix/audit-g3-open-editor` | `fix(ui): wire Files open-in-editor to /api/fs/open` | `src/cli/ui/dashboardHtml.ts`, `src/cli/ui.ts` only if Windows `open` is broken |
| 16 | A3 | `fix/audit-a3-dead-routes` | `docs: match README to live Files/graph APIs` | `README.md` |

Skip **G4** (Cursor `--mode plan\|ask`): optional product work, not a broken promise.

## Finding goals (what “done” means)

### C2 — stream-json duplicates
Append assistant text only when `timestamp_ms` is present **and** `model_call_id` is absent. Skip the other two `--stream-partial-output` shapes. Cite Cursor output-format docs in the commit body if useful.

### C3 — headless prompts
On the UI `cursor-agent --print` path, add `--trust`. Add `--approve-mcps` so MCP approval cannot block piped stdio. Do not add these on the interactive CLI passthrough unless it also uses `--print` with piped stdin.

### U1 — stop / stdout
On child `close`, parse any leftover `stdoutBuffer` line. On `/api/agent/:id/stop`, SIGTERM then SIGKILL after a short grace (e.g. 2s) if still alive. Do not leave zombie `agentRunChildProcesses` entries.

### I3 — models cache
Keep the in-memory model list across `/api/models/selectable` calls. Refresh on TTL (e.g. 60s) or an explicit refresh flag, not on every dropdown load.

### U2 — model mismatch
If `cursor-agent models` did not yield a label for the requested id, **do not** SIGTERM. Only stop when init/result clearly reports a different resolved model than requested.

### C1 — session_id
Read `system.init.session_id` (and `result.session_id` as fallback). Persist it on the Winnow session record. Next native `--resume` must use that UUID, not `${Date.now()}-${rand}`. Keep a Winnow record id if needed, but resume must be Cursor’s id.

### C5 — create-chat
For a true new UI Cursor run (no resume UUID), call `createCursorSession` / `cursor-agent create-chat` and spawn with `--resume <new-id>` (or equivalent so the CLI owns a real chat id from turn one). Reuse the helper in `src/cursor/sessionUtils.ts`.

### C4 — --resume args
Fix dashboard template-literal regex (`\\s` not `\s`). Do not strip UUID `--resume` values the user (or the client) passed. Remove or rewrite the hint that says to put `--resume` in Cursor Args if the server still discards it.

### G2 — continue session
Picking a session in the resume control, or **Continue selected**, must actually resume. Default-off `continueMode` must not silently start a new chat. Checking the box for the user or dropping the extra gate are both acceptable; the picker must match user intent.

### I2 — preamble bloat
After C1, do **not** prepend local history when native `--resume` is in effect. Cap graph seed; keep plan context modest. Heuristic Engine may stay, but default or size should not dump ~28k chars every run.

### A1 — withToken
`withToken(...)` on plan GitHub save, tasks GET, github/sync, and plan reconcile in `mainGridHtml.ts`. Same pattern as neighboring `fetch` calls.

### I1 — graph load
Stop fetching `limit=2000` nodes and `limit=4000` edges as the initial technical graph. Use summary and/or neighborhood expansion already served by `/api/graph/*`.

### A2 — dashboard vs /agent
Dashboard agent `start` payload must include `planId` and `executionMode` (and the matching controls, or hide the dashboard agent and point to `/agent`). No silent Cursor-only subset.

### G1 — thinking copy
Print mode has no thinking events. Rename UI copy to a tool/status trace. Fix README “thinking + chat” wording.

### G3 — open in editor
Files UI calls `POST /api/fs/open`. Button next to preview. Keep path sandbox (`resolveUiPath`).

### A3 — README
Document what exists: preview works; open-in-editor after G3; graph summary endpoint may remain unused. Do not claim APIs the UI does not call unless you mark them as server-only.

## Integration / test / merge

```bash
# After each worktree finishes, on fix/audit-findings:
git cherry-pick <sha>

# Full suite after each pick (and once at the end):
npm test
npm run build   # if types/UI compile is in doubt

# Manual UI (user):
npm run ui
# C1/C5: run twice, confirm second spawn has --resume <uuid>
# C2: no doubled last assistant paragraph
# C3: new workspace does not hang
# A1: UI with ?token= still saves GitHub mappings
# I1: graph tab opens without dumping the whole DB
# G2: pick a session, Run, confirm resume without hunting a checkbox
```

**Merge:** when the queue is complete and the user has tested, open a PR from `fix/audit-findings` into `feat/plans-github-sync` (or `main` if they choose). One PR, sixteen reviewable commits. Cherry-pick or revert any single SHA if a finding is wrong.

## Post-audit checkpoint: Node 26 sqlite

Saved **before** the model-picker work. Homebrew Node 26 (`NODE_MODULE_VERSION` 147) could not load `better-sqlite3` 11 (compiled for Node 22, ABI 127). Rebuilding 11 from source also fails on 26 (missing C++ `<source_location>`).

**Fix:** upgrade to `better-sqlite3` 13 (N-API prebuilds, engines `>=22`). One binary loads on Node 22 and Node 26. `npm run ui` probes sqlite + `node-pty` and rebuilds with the **running** Node’s npm (bin dir prepended to `PATH`) if an ABI mismatch remains.

**Requires Node 22+.** Do not commit `.winnow/*` or screenshots with this step.

| Files | Why |
| --- | --- |
| `package.json`, `package-lock.json` | sqlite 13, engines `>=22` |
| `scripts/run-ui.js`, `scripts/nativeAbi.mjs`, `scripts/native-modules-check.mjs` | ABI probe + same-Node rebuild |
| `scripts/check-node-version.js`, `scripts/setup.sh`, `scripts/setup.ps1` | setup/runtime Node 22 |
| `tests/nativeAbi.test.ts` | mismatch + PATH helper |
| `src/cli/ui.ts`, `README.md` | Node 22 copy |

**Next (not in this commit):** model dropdown currently shows Auto / Composer only; research Cursor CLI model list and wire the real options.

## Subagent status

Parent chat fills this in as worktrees return.

| ID | Status | SHA | Notes |
| --- | --- | --- | --- |
| C2 | queued | | |
| C3 | queued | | |
| U1 | queued | | |
| I3 | queued | | |
| U2 | queued | | |
| C1 | queued | | |
| C5 | queued | | |
| C4 | queued | | |
| G2 | queued | | |
| I2 | queued | | |
| A1 | queued | | |
| I1 | queued | | |
| A2 | queued | | |
| G1 | queued | | |
| G3 | queued | | |
| A3 | queued | | |
