# Cursor modes and commands in Winnow

Playbook for recreating the Cursor IDE **mode picker** and **`/` commands** inside Winnow’s agent composer. Land **one commit per ID**. Do not implement until a session is pointed at a specific ID.

**Integration branch:** current feature branch (today: `feat/network-ready-ui`)  
**Do not push or merge unless the user asks.**

Leave `.winnow/*`, screenshots, and unrelated untracked files out of every commit.

---

## How to use this file

1. Read **Source of truth** and **Winnow today** before writing code. Re-fetch Cursor docs; do not trust memory.
2. Paste **Implementation prompt** (below) into a new agent session, then add: `Implement only <ID>.`
3. Keep `cursor-agent` spawn + stdin + NDJSON. Do **not** migrate to `@cursor/sdk`.

---

## Implementation prompt

Copy from here through the end of **Constraints**.

```
You are implementing Cursor IDE parity for modes and slash commands inside Winnow.

Winnow is a local cockpit that wraps cursor-agent as a child process
(--print --output-format stream-json --stream-partial-output). It is not the
Cursor IDE and not an interactive TTY. Interactive CLI slash commands
(/plan, /ask, /debug, /model, …) never reach the agent in print mode.
Winnow must own the composer UX and map it onto CLI flags or prompt text.

## Product goal

Recreate the Composer experience from Cursor IDE:

1. Built-in modes: Agent (default), Ask (read-only), Plan (design first).
2. A `/` palette in the prompt box: skills + custom commands, filterable.
3. Custom Modes: pin a skill for the whole session (IDE: Option+Enter /
   “Use as Mode”), with a dismissible badge on the composer.
4. Do not pretend to be the interactive Cursor CLI. Skip TTY-only slash
   commands (/vim, /quit, /copy-request-id, /setup-terminal, …).

## Cursor facts (verified 2026-08-31)

IDE modes (https://cursor.com/help/ai-features/agent):
  Agent = edit + tools. Ask = read-only. Plan = research then plan
  (edits after the user approves). Debug = runtime-evidence bugs.
  Shift+Tab cycles modes. Switching modes starts a fresh context in IDE;
  Winnow should keep --resume when Continue is on unless Cursor proves
  that --mode change requires a new chat (Unverified — test in M1).

CLI flags (cursor-agent --help and https://cursor.com/docs/cli/reference/parameters):
  --mode <mode> choices are ONLY "plan" and "ask".
  --plan is shorthand for --mode=plan.
  Agent is the default when --mode is omitted. There is NO --mode=agent
  and NO --mode=debug.

CLI using (https://cursor.com/docs/cli/using):
  Same modes as the editor via slash commands or --mode.
  Custom Modes: pick a skill in `/`, Enter = this message only,
  Option+Enter = stay on until you exit.

Skills (https://cursor.com/docs/skills):
  Discovered from .cursor/skills/, .agents/skills/, ~/.cursor/skills/,
  ~/.agents/skills/, plus Claude/Codex compat dirs. Nested SKILL.md
  folders are valid. Frontmatter: name, description, paths,
  disable-model-invocation, icon, color.
  disable-model-invocation: true => explicit `/name` only (legacy command).
  Built-in Cursor skills (/review, /create-rule, /create-skill, …) are
  managed by Cursor, not files in this repo.

Commands (https://cursor.com/docs/reference/plugins + deeplinks):
  Markdown/text in commands/ (plugin) or .cursor/commands (project)
  and ~/.cursor/commands (user). Frontmatter name + description.
  Body is the reusable prompt. Cursor is migrating commands → skills
  via /migrate-to-skills; Winnow must still discover both.

Print-mode trap:
  --print “has access to all tools, including write and shell”.
  Combined with --mode ask|plan this SHOULD still be read-only / plan
  at the Cursor layer. Verify with a live spawn before shipping M1.
  If print mode ignores --mode tool limits, fall back to a hard prompt
  prefix (“do not write any code / do not edit files”) AND still pass
  the flag.

## Winnow today (do not break)

- “Mode” in the agent window is NOT Cursor mode. It is execution backend:
  cursor vs external. Select id=agentExecutionMode.
  Relabel the UI to “Backend” (or “Runtime”) when the Cursor mode
  picker lands. Keep the field name in JSON as executionMode.
- “Plan” dropdown (id=agentPlanSelect, payload.planId) scopes a
  .winnow/plans/*.md document into the prompt. That is NOT Cursor Plan
  mode. Keep both. Labels: “Cursor mode” vs “Winnow plan”.
- autonomyMode → --force + --sandbox disabled. Keep. Ask/Plan must
  still send --mode; do not invent a second autonomy mapping.
- Heuristic Engine (graphSeed) and continue/--resume stay as they are.
- Agent start: POST /api/agent/start. Types: src/cli/ui/types.ts
  AgentStartRequest. Schema: src/cli/ui/apiSchemas.ts.
  Spawn args: ensureExecutionArgs in src/cli/ui.ts.
- Composer lives in TWO HTML modules that already drifted once:
  src/cli/agentWindowHtml.ts and src/cli/ui/dashboardHtml.ts.
  Ship the same mode + `/` behavior in both, or extract shared JS.
  Main grid iframe hosts /agent?embed=1 — companion is the primary UX.
- Discovery pattern to copy: listSubagentDefinitionFiles in
  src/cursor/subagents.ts (user then project; later writer wins by name).
- External backend (executionMode=external) cannot receive --mode.
  Emulate Ask/Plan with a system-prompt prefix only. No cursor-agent flags.
- Do not pass Winnow local session ids to --resume.
- Do not prepend local history when native --resume is in effect.

## What to build (map IDE → Winnow)

Composer chrome (Agent + Ask + Plan):
  A compact mode control next to the prompt (dropdown or segmented
  control), default Agent. Shift+Tab cycles Agent → Plan → Ask → Agent.
  Persist last choice in localStorage (e.g. winnow.agentCursorMode).
  On Run, send cursorMode: "agent" | "ask" | "plan".
  Server: if cursor and ask → ensure --mode ask.
          if cursor and plan → ensure --mode plan (or --plan).
          if agent → do not pass --mode.
  Strip any user-supplied --mode / --plan from Cursor args so the
  picker is source of truth (same idea as stripping --resume).

`/` palette:
  When the user types `/` at the start of the prompt or after whitespace,
  open a filterable list. Groups: Modes, Commands, Skills, Winnow.
  Built-in Winnow entries can wrap existing quickbar chips
  (Implement + tests, Review, Refactor) so we do not keep two prompt
  libraries.
  Arrow keys + Enter select. Escape / Backspace-to-empty closes.
  Selecting a command or explicit skill:
    - Replace the `/token` with nothing.
    - Send slashInvocations: [{ kind, id }] with the remaining prompt.
    - Server expands: command/skill body as a preamble, then
      ## User request, then the leftover prompt.
    - If the file contains $ARGUMENTS, substitute the leftover prompt.
  Selecting /ask or /plan changes cursorMode and does not inject text.
  Built-in Cursor skills that are not on disk: insert `/name` plus a
  newline as the prompt prefix (Unverified whether print-mode honors
  a leading slash; if a live test fails, document and skip builtins).

Custom Mode:
  In the palette, Option/Alt+Enter or “Use as mode” pins a skill.
  Show a badge on the composer (name, optional color). Click X to exit.
  Persist on the Winnow session record and re-send on every turn until
  dismissed. Server prepends that SKILL.md on every startAgentSession
  for that chat (in addition to one-shot slashInvocations).
  Do not confuse this with --mode. Custom Mode is prompt context, not
  a cursor-agent flag.

Debug:
  cursor-agent --help does not accept --mode debug. Do not pass it.
  Optional later: a Winnow skill that instructs runtime-evidence
  gathering. Not part of M1–M3.

## Naming (use these words in UI and code)

| Concept | UI label | Payload / code |
| --- | --- | --- |
| cursor-agent vs external provider | Backend | executionMode |
| Agent / Ask / Plan | Mode | cursorMode |
| .winnow/plans scope | Winnow plan | planId |
| Skill pinned for the session | Custom mode badge | customModeSkill |
| One-shot `/foo` | Command / skill in palette | slashInvocations |
| --force + sandbox off | Autonomous | autonomyMode |

## Constraints

- One ID per commit. Named files only. No git add -A.
- npm test before commit. Add focused tests for discovery + arg building
  (not only HTML string contains).
- UI: keep the existing two-tone dark theme. Composer stays at the bottom.
- Fetch current Cursor CLI docs again if more than a few days have passed:
  https://cursor.com/docs/cli/reference/parameters
  https://cursor.com/docs/cli/using
  https://cursor.com/docs/skills
- If you need a file outside Allowed files for that ID, stop and report.
- Report: ID, files, how --mode is passed, how `/` expands, test result,
  what you could not verify without a live cursor-agent run.
```

---

## Source of truth

Re-fetch before scoring a change. Dates below are when this plan was written.

| Surface | URL / command | What it gives Winnow |
| --- | --- | --- |
| IDE modes | https://cursor.com/help/ai-features/agent | Agent / Ask / Plan / Debug; Shift+Tab |
| CLI flags | `cursor-agent --help`, https://cursor.com/docs/cli/reference/parameters | `--mode plan\|ask`, `--plan`; no debug |
| CLI using | https://cursor.com/docs/cli/using | Slash + `--mode`; Custom Modes via skills |
| Skills | https://cursor.com/docs/skills | Directories, frontmatter, `/` vs Option+Enter |
| Commands | https://cursor.com/docs/reference/plugins | `commands/*.md` shape |
| Interactive slashes | https://cursor.com/docs/cli/reference/slash-commands | Most of these are TTY-only — do not clone |

Interactive CLI slashes we **do not** recreate as Winnow chrome: `/vim`, `/line-numbers`, `/show-thinking` (thinking is suppressed in `--print`), `/setup-terminal`, `/quit`, `/exit`, `/logout`, `/copy`, `/copy-request-id`, `/copy-conversation-id`, `/feedback`, `/open`, `/config`, `/plugin`, `/bedrock`, `/max-mode`, `/rename`, `/fork`, `/rewind`, `/logs`, `/update`, `/about`, `/help`.

Already covered by existing Winnow controls (do not add a second `/` alias unless it is a thin palette row):

| CLI slash | Existing Winnow control |
| --- | --- |
| `/model` | Model Pref select |
| `/resume` `/clear` `/new` | Resume picker, Start Fresh |
| `/sandbox` `/run-everything` | Autonomous checkbox |
| `/plan` | **New** Cursor mode, not Winnow plan dropdown |
| `/ask` | **New** Cursor mode |
| `/debug` | Out of scope until CLI grows `--mode debug` |
| `/shell` | Main-grid PTY / Workspace shell tab |

---

## Winnow today (evidence)

| Behavior | Where |
| --- | --- |
| Spawn flags, no `--mode` | `ensureExecutionArgs` in `src/cli/ui.ts` |
| Start payload | `AgentStartRequest` in `src/cli/ui/types.ts`; zod in `src/cli/ui/apiSchemas.ts` |
| Companion composer | `src/cli/agentWindowHtml.ts` (`#agentPrompt`, `#agentExecutionMode` labeled “Mode”) |
| Dashboard composer | `src/cli/ui/dashboardHtml.ts` (same start fields, no execution-mode select in the run row) |
| Quickbar canned prompts | Both HTML modules — proto-commands, not a `/` menu |
| Winnow plan scope | `#agentPlanSelect` → `payload.planId` → plan markdown preamble |
| Subagent file discovery (copy this) | `listSubagentDefinitionFiles` in `src/cursor/subagents.ts` |
| Audit note that `--mode` is a product gap, not a bug | `docs/audit-fix-plan.md` (skip G4); `.cursor/skills/winnow-codebase-audit/cursor-cli-traps.md` |

---

## Architecture

```
Composer  --cursorMode-->  POST /api/agent/start
          --slashInvocations-->     |
          --customModeSkill-->      v
                            startAgentSession
                              ├─ cursor: ensureCursorModeArg(args, cursorMode)
                              ├─ expand slash + custom-mode files into effectivePrompt
                              └─ external: system prefix for ask/plan only
```

**Expand on the server**, not in duplicated browser strings. HTML only collects ids and leftover prompt text.

Suggested new module: `src/cursor/slashCatalog.ts` (list + parse + expand). Mirror subagent discovery:

1. User dirs first, then project dirs (project wins on `name`).
2. Commands: `~/.cursor/commands/*.{md,mdc,markdown,txt}`, `<project>/.cursor/commands/` same.
3. Skills: walk `SKILL.md` under `.cursor/skills`, `.agents/skills`, `~/.cursor/skills`, `~/.agents/skills`, plus `.claude/skills` and `.codex/skills`. Nested folders OK; identity is the folder that contains `SKILL.md`.
4. Cap body size when injecting (same order of magnitude as plan preamble, ~12k chars).

`GET /api/agent/slash-catalog` returns names, descriptions, kinds, scopes — not full bodies.

Persist `cursorMode` and `customModeSkill` on `LocalSessionRecord` so Continue does not drop them.

---

## Rules (every subagent)

1. **One ID per commit.** No drive-by refactors, no extra IDs.
2. **Named files only.** Never `git add .` or `git add -A`.
3. Stay inside **Allowed files**. If you need another file, stop and report.
4. Commit via HEREDOC. Hooks on. No `--no-verify`, no amend, no force, no push, no merge unless the user asks.
5. **Do not migrate to `@cursor/sdk`.**
6. `npm test` before commit. Unit-test catalog parsing and `ensureCursorModeArg`.
7. UI: existing two-tone dark theme. Do not restyle the whole app.
8. Verify composer in **both** `/agent` and dashboard Agent workspace, plus `/agent?embed=1` if you touched companion HTML.
9. Report: branch, SHA, files, test result, residual risk, live `--mode` verification if you did it.

---

## Commit queue

| # | ID | Suggested branch | Commit message | Allowed files |
| --- | --- | --- | --- | --- |
| 1 | M1 | `feat/cursor-mode-flag` | `feat(agent): pass --mode ask\|plan from the composer` | `src/cli/ui.ts`, `src/cli/ui/types.ts`, `src/cli/ui/apiSchemas.ts`, `src/cli/agentWindowHtml.ts`, `src/cli/ui/dashboardHtml.ts`, tests |
| 2 | M2 | `feat/slash-catalog` | `feat(agent): discover Cursor commands and skills` | `src/cursor/slashCatalog.ts`, `src/cli/ui.ts`, tests |
| 3 | M3 | `feat/slash-palette` | `feat(ui): `/` palette for commands and skills` | `src/cli/agentWindowHtml.ts`, `src/cli/ui/dashboardHtml.ts`, `src/cli/ui.ts`, `src/cli/ui/types.ts`, `src/cli/ui/apiSchemas.ts`, tests |
| 4 | M4 | `feat/custom-mode` | `feat(ui): pin a skill as a session Custom Mode` | Same as M3 plus session record types, tests |
| 5 | M5 | `feat/mode-relabel` | `fix(ui): rename backend Mode vs Cursor Mode vs Winnow plan` | Agent + dashboard HTML, tests |

Do M5 in the same commit as M1 if the label collision would ship user-visible “Mode” twice. Prefer one commit if both are small; otherwise M1 ships the picker with a distinct label immediately.

---

## M1 — Built-in Agent / Ask / Plan

### Vision

The composer has a Cursor **Mode** control. Agent is default. Ask and Plan spawn `cursor-agent` with `--mode ask` or `--mode plan`. Keyboard: Shift+Tab cycles.

### Goals

- Payload `cursorMode?: "agent" | "ask" | "plan"` (omit or `agent` => no `--mode` flag).
- `ensureCursorModeArg` (or equivalent) in the UI spawn path. Strip conflicting `--mode` / `--plan` from raw Cursor args.
- External backend: prefix the system message for ask/plan; never pass CLI flags.
- Companion + dashboard both send `cursorMode`. Persist last UI choice.
- Collapsed companion controls still show the current Cursor mode (not only model).
- Live check (mark Unverified in the commit if you cannot run it): `cursor-agent --print --mode ask` refuses edits; `--mode plan` stays in planning.

### Tests

- Arg helper: agent => no `--mode`; ask => `--mode ask`; plan => `--mode plan` or `--plan`; user `--mode` in args is replaced, not duplicated.
- Schema accepts the new field and rejects junk.
- HTML contract: mode control id (e.g. `agentCursorMode`) exists in both page builders; Shift+Tab handler present.

### Residual

Debug mode. Print-mode vs read-only if Cursor ignores `--mode` under `--print`.

---

## M2 — Slash catalog (server)

### Vision

Winnow can list the same commands and skills Cursor would load for this workspace, without spawning an extra agent.

### Goals

- `slashCatalog.ts`: parse command files and `SKILL.md` frontmatter; expand `$ARGUMENTS`.
- `GET /api/agent/slash-catalog` behind the same token gate as other `/api/agent/*` routes.
- Do not walk `node_modules`. Bound directory depth. Ignore unreadable dirs.
- Built-in Cursor skills: optional static list (name + description only) flagged `source: "cursor-builtin"`. Empty bodies.

### Tests

- Temp dirs with a command markdown and a nested skill; project overrides user on the same `name`.
- Invalid frontmatter skipped, not thrown.
- Expand: body + user text; `$ARGUMENTS` substitution.

---

## M3 — `/` palette (client)

### Vision

Typing `/` in `#agentPrompt` opens a Cursor-like menu. Selecting an item invokes it for **this send**.

### Goals

- Overlay anchored to the composer, keyboard complete, does not steal Run (⌘/Ctrl+Enter still runs when the palette is closed).
- Fetch catalog once per focus (or on first `/`), refresh on workspace cwd change.
- One-shot invocation goes through `slashInvocations` on start; leftover textarea is the user request.
- `/ask` and `/plan` (and `/agent`) change `cursorMode` and close the menu.
- Keep quickbar buttons working; they may call the same append helper.

### Tests

- HTML includes palette markup + `/` keydown on `#agentPrompt`.
- Start payload includes `slashInvocations` in both UIs.
- Server expands a fixture command into `effectivePrompt` (or a helper return value).

### Residual

Leading `/review` for Cursor-builtin skills in `--print` (live test).

---

## M4 — Custom Mode (pin skill)

### Vision

Option+Enter (and a “Use as mode” row action) keeps a skill in context on every turn until the badge is dismissed — Cursor Custom Modes.

### Goals

- Badge on the composer; stored on the session record; reapplied on Continue.
- Mutually exclusive with a second pinned skill (replace, do not stack) unless a live Cursor test shows stacking — default to one.
- Still not a `--mode` flag.

### Tests

- Two consecutive starts with the same `customModeSkill` both contain the skill body.
- Dismiss stops injecting.

---

## M5 — Label collision cleanup

Only if M1 did not already rename:

- `agentExecutionMode` label → **Backend**.
- Cursor picker → **Mode**.
- Plan dropdown → **Winnow plan**.

---

## Out of scope (this program)

- Recreating the interactive CLI `/` command set as a TTY.
- `--mode debug` or a fake debug flag the binary will reject.
- Cloud Agent `&` handoff.
- `@cursor/sdk`, ACP (`agent acp`), or a second agent process for modes.
- Migrating this repo’s own `.cursor/skills` into Winnow commands.
- Redesigning the companion theme.

---

## Suggested live checks (M1 / M3)

```bash
# Confirm flag surface (should list plan, ask only)
cursor-agent --help | rg --mode

# Ask should not edit (use a throwaway clone). Unverified until run.
cursor-agent --print --mode ask --output-format text --trust --workspace . \
  "Create a file named SHOULD_NOT_EXIST.txt with hello"
```

If that spawn writes the file, print-mode Ask is unsafe; ship the prompt-prefix fallback and file a comment on the M1 commit.

## Unification (2026-08-31)

Parallel agents landed on the same dirty tree (disjoint files). Parent then:

- Fixed companion `/ask` `/plan` applying `item.id` (`mode:ask`), which `setCursorMode` rejected as Agent. Both UIs now use `item.name`.
- Stopped companion from duplicating Agent/Ask/Plan rows when the live catalog already includes `kind: "mode"`.
- Reversion refs unchanged: `refs/backup/pre-modes-commands-head`, `refs/backup/pre-modes-commands-wip`.

---

## Reversion (2026-08-31 parallel implementation)

Created **before** the M1–M5 coding agents touched the tree.

| Ref | SHA | What it is |
| --- | --- | --- |
| `refs/backup/pre-modes-commands-head` | `88481b60b4d03a3f4a6f4188e8663d8ed3e3756c` | `feat/network-ready-ui` HEAD |
| `refs/backup/pre-modes-commands-wip` | `9317572fbf6041040ebafb41fb2d65a0a21aa492` | `git stash create` of tracked dirty files (pricing/UI WIP). Does **not** include untracked files. |

Restore the pre-implementation working tree:

```bash
git reset --hard refs/backup/pre-modes-commands-head
git stash apply refs/backup/pre-modes-commands-wip
```

Do **not** delete these refs until the user confirms the feature.

Untracked at snapshot time (not in the stash): `docs/modes-and-commands-plan.md`, `tests/pricing.test.ts`, `.cursor/`, screenshots, sqlite WAL files.

---

## Frozen parallel contract

Three agents own **disjoint files**. Do not edit another agent's files. Parent unifies.

### File ownership

| Agent | Allowed files only |
| --- | --- |
| **SERVER** | `src/cursor/cursorMode.ts` (new), `src/cursor/slashCatalog.ts` (new), `src/cli/ui/types.ts`, `src/cli/ui/apiSchemas.ts`, `src/cli/ui.ts`, `tests/cursorMode.test.ts` (new), `tests/slashCatalog.test.ts` (new), `tests/apiSchemas.test.ts` |
| **COMPANION** | `src/cli/agentWindowHtml.ts`, `tests/agentWindowHtml.test.ts` |
| **DASHBOARD** | `src/cli/ui/dashboardHtml.ts`, `tests/dashboardHtml.test.ts` |

### Git rules for coding agents

- **Do not** `git add`, `git commit`, `git push`, `git reset`, `git checkout`, `git stash`, or amend.
- **Do not** edit `.winnow/`, screenshots, or unrelated WIP (`src/data/pricing.ts`, `src/data/usageStore.ts`).
- If you cannot finish without extra files, **stop and report**. Parent will wire leftovers.
- Run only your new/focused tests (`npx vitest run tests/cursorMode.test.ts` etc.). Parent runs `npm test`.

### Payload (`POST /api/agent/start`)

Extend `AgentStartRequest` / `agentStartRequestSchema`:

```ts
cursorMode?: "agent" | "ask" | "plan"  // default agent
slashInvocations?: { kind: "command" | "skill" | "winnow" | "builtin-skill"; id: string }[]
customModeSkill?: string  // skill name pinned for the session
```

`prompt` may be empty/whitespace **only if** `slashInvocations.length > 0` or `customModeSkill` is set; otherwise still required.

### Spawn (`cursor` backend)

- `cursorMode === "ask"` → `--mode ask`
- `cursorMode === "plan"` → `--mode plan` (not `--plan`, to keep one form)
- `cursorMode === "agent"` or omitted → do **not** pass `--mode`
- Strip any `--mode`, `--mode=…`, and `--plan` from user Cursor args first
- Never pass `--mode debug` or `--mode agent`
- Also prepend Ask/Plan instruction blocks into the prompt (print-mode belt and suspenders)

### Catalog (`GET /api/agent/slash-catalog`)

```json
{ "ok": true, "items": [/* SlashCatalogItem, no bodies */] }
```

Token gate is already applied to all `/api/*`. Use `uiWorkspace.dir` + `homedir()`.

### DOM ids (both UIs)

| Id | Role |
| --- | --- |
| `agentCursorMode` | `<select>` Agent / Ask / Plan |
| `agentSlashPalette` | overlay list, `hidden` when closed |
| `agentSlashPaletteList` | rows inside the palette |
| `agentCustomModeBadge` | pinned skill chip; `hidden` when none |
| `agentCustomModeName` | name text inside the badge |
| `agentCustomModeClear` | dismiss button inside the badge |
| `agentPrompt` | existing textarea (do not rename) |
| `agentExecutionMode` | backend select (companion only). Label **Backend**, never **Mode**. |
| `agentPlanSelect` | Winnow plan (companion). Label **Winnow plan**. |

localStorage: `winnow.agentCursorMode`, `winnow.agentCustomModeSkill`.

### Keyboard

- `/` at start of textarea or after whitespace: open palette, do not insert `/` until no match / Escape
- ArrowUp/Down, Enter select (one-shot), Escape close
- Option/Alt+Enter on a **skill** row: pin Custom Mode (do not one-shot)
- Shift+Tab on `#agentPrompt` when palette closed: cycle agent → plan → ask → agent
- Cmd/Ctrl+Enter: Run (existing). If palette open, Enter selects, Cmd+Enter still runs.

### Start payload from both composers

```js
cursorMode: document.getElementById("agentCursorMode").value || "agent",
slashInvocations: pendingSlashInvocations, // cleared after successful start
customModeSkill: pinnedSkillName || undefined,
```

`/ask` `/plan` `/agent` rows change `agentCursorMode` and close the palette; they are **not** slashInvocations.
