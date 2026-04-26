# Plan: Plan store, stable schema (datatype), and AI planning workflow

This document is the **implementation blueprint** for improving the AI workflow: where plans live on disk, when they are generated, how they are produced, and how a **fixed JSON shape (like a datatype)** lets another tab reliably read plans and generate to-do lists—even when the user **edits or revises** a plan over time.

---

## Goals

1. **Storage**: Under each workspace’s `.winnow/` tree, add a dedicated directory for **plan artifacts** (not chat logs, not sessions).
2. **Triggers**: Create a plan when the user explicitly asks (e.g. “Let’s create a plan”) **or** when the system classifies the task as **long / multi-phase** (heuristic + optional model assist).
3. **Algorithm**: A **structured, multi-phase planning pipeline** (not a single prompt dump) that outputs a document that **conforms to the plan schema**.
4. **Stable structure, dynamic content**: The **schema** of each plan document is **versioned and stable** (same conceptual “datatype” across the app). Individual **plans are mutable**—users can ask to change phases, goals, or wording; updates **replace or patch** the same `planId` file after validation. A second tab reads the **current** document shape and projects **derived** to-do lists (derived files stay separate from the canonical plan body).

---

## 1. On-disk layout (`.winnow`)

**Proposed paths** (relative to `uiWorkspace.dir` / project root used by Winnow today):

| Path | Purpose |
|------|---------|
| `.winnow/plans/` | Root for all plan artifacts |
| `.winnow/plans/index.json` | Manifest: plan ids, titles, `updatedAt` for list UI (optional denormalization) |
| `.winnow/plans/<planId>.json` | **Living** plan document: same id, **updated** when the user revises the plan; must always validate against the active schema |
| `.winnow/plans/derived/<planId>.todos.json` | **Derived** projection: to-do list generated from the **current** plan snapshot (safe to overwrite or delete; regenerated when plan changes) |

**Gitignore**: Add `.winnow/plans/derived/` (or full `plans/`) per sensitivity—product decision. Default: ignore **`derived/`** only if you want todos local; otherwise commit nothing sensitive.

**Bootstrap**: Extend existing workspace bootstrap so `plans/` and `plans/derived/` exist when first needed.

---

## 2. Stable schema vs dynamic plan (contract for “another tab”)

**Think of the plan file as an instance of a datatype**

- **`schemaVersion`** (integer, required): Bump only when the **shape** of the document changes (new required fields, renamed keys, different nesting). Readers and writers use Zod (or equivalent) keyed by `schemaVersion`.
- **Plan content is dynamic**: Any field **inside** the allowed schema may change when the user says “change step 2” or “drop the migration phase.” Updates run through **validate → write** (full document or PATCH that merges then validates).
- **Concurrency**: Prefer **read-modify-write** with optional `revision` (monotonic integer) or `etag` / `contentSha256` in the file so a tab can detect conflicts (“plan changed on disk; reload or merge”).
- **`updatedAt`**: Set on every successful write.

**Derived todos**

- Stored under `derived/` only. Include `{ planId, planRevision or planContentSha256, generatedAt, items[] }` so the todo tab can show **stale** if the plan moved on without regenerating todos.
- Regenerate todos whenever the user asks or when `planContentSha256` / `revision` no longer matches the derived file.

**Why separate “datatype” from “instance”**

- Tab A (plan editor/viewer): reads and writes **the same** `<planId>.json` through an API that **always validates** against the schema for `schemaVersion`.
- Tab B (todos): reads the validated plan, writes **only** `derived/…`; never needs to invent new keys on the plan object.

---

## 3. Optimized JSON structure (canonical plan document)

Design for **small hot fields** at the top for list UIs, heavy text in nested objects, stable **ids inside arrays** so edits can target nodes.

```json
{
  "schemaVersion": 1,
  "planId": "pln-20260426-abc123",
  "createdAt": "2026-04-26T12:00:00.000Z",
  "updatedAt": "2026-04-26T14:30:00.000Z",
  "revision": 4,
  "workspaceRoot": "/abs/path",
  "source": { "kind": "user_explicit|heuristic_long_task", "triggerPhrase": "Let's create a plan", "sessionId": null },
  "summary": { "title": "…", "goal": "…", "successCriteria": ["…"] },
  "constraints": { "time": null, "risk": "low|med|high", "mustNot": ["…"] },
  "phases": [
    {
      "id": "ph-1",
      "name": "Discovery",
      "objectives": ["…"],
      "artifacts": ["path/or/glob"],
      "dependencies": [],
      "estimates": { "complexity": 1, "confidence": 0.7 }
    }
  ],
  "edges": [{ "from": "ph-1", "to": "ph-2", "kind": "blocks" }],
  "openQuestions": [{ "id": "q-1", "text": "…", "blocking": true }],
  "checkpoints": [{ "id": "cp-1", "description": "…", "verify": ["command or manual step"] }],
  "contentSha256": "…"
}
```

**`contentSha256`**

- Optional but useful: hash of a **canonical serialization** of the plan body (excluding the hash field) so derived todos and clients know “this file changed.” Recomputed on every successful save.

**Optimization tactics**

- Arrays of **objects with stable `id`** everywhere (phases, questions, checkpoints) so edits and LLM patches can target nodes without reshaping the tree.
- **`edges`** separate from nested phases for graph logic.
- Long prose inside **`summary`** / phase **objectives**; avoid duplicating session logs.

**Validation**

- Single module: `src/plans/planDocumentSchema.ts` (or similar)—**parse inbound JSON, reject unknown `schemaVersion`**, strip unknown keys or reject strict mode.

---

## 4. “Extensive planning algorithm” (pipeline)

Implement as **pure steps** + optional **LLM calls** per step (DeepSeek already in stack). Each step mutates an in-memory builder that **still conforms** to the schema; final step assigns ids, computes hash, sets timestamps, writes.

**Phase 0 — Intake**

- Normalize user text; detect explicit “plan” intent (regex + light classifier).
- **Long-task heuristic** (no LLM): token/line count, verbs, file paths, multi-phase language, etc. Score > threshold → auto plan.

**Phase 1 — Decomposition**

- LLM: output structured JSON matching an **intermediate** schema; map into the **canonical** plan datatype.
- Validate + repair loop (max N).

**Phase 2 — Dependency graph**

- Deterministic: build `edges`; topological sort; cycles → `openQuestions`.

**Phase 3 — Risk and constraints**

- LLM or rules: fill `constraints`, `mustNot`, etc.

**Phase 4 — Checkpoints**

- Templates + LLM refinement.

**Phase 5 — Consolidation**

- Merge duplicate phases; cap max phases; ensure unique ids; bump `revision` / set `updatedAt`.

**Phase 6 — Persist**

- Atomic write: temp file + `rename` over `<planId>.json` (or write then rename) to avoid torn reads. Update `index.json` with latest `updatedAt` / title.

**User-driven edits (“change the plan”)**

- Same pipeline entry with **mode: `revise`**: load current plan, apply natural-language diff via LLM into the builder, **re-validate full document**, save (same `planId`, higher `revision`).

**Failure modes**

- If validation fails after LLM step: do not write; return errors to the UI. Optionally persist last-known-good is a separate product choice.

---

## 5. Trigger wiring (where behavior hooks in)

| Surface | Behavior |
|---------|----------|
| **Cursor / agent chat** | Rule or slash command → create or revise plan via API. |
| **Dashboard / agent UI** | “Create plan from prompt” + heuristic nudge; “Apply edit to plan” when a plan is open. |
| **CLI** | `winnow plan create` / `winnow plan revise --id …` |

**API** (minimal first slice)

- `POST /api/plans` — create: body `{ prompt, source, sessionId? }` → pipeline → `{ planId }`.
- `GET /api/plans` — list from index.
- `GET /api/plans/:id` — current plan JSON.
- `PATCH /api/plans/:id` — body: partial JSON or `{ instruction: "…" }` for LLM-assisted revise; response full plan after validate.
- `GET /api/plans/:id/derived/todos` — read derived projection.
- `POST /api/plans/:id/derived/todos` — regenerate todos from **current** plan (hash/revision check).

**Writes**

- Plan body: only through validated paths above (no raw hand-edited invalid JSON on disk from the app).

---

## 6. Codebase touchpoints (implementation order)

1. **`src/plans/`**: Zod schemas per `schemaVersion`, `readPlan`, `writePlanAtomic`, `updatePlanValidated`, `listPlans`, `computeContentSha256`.
2. **`src/cli/ui.ts`** (or router module): HTTP routes; auth as today.
3. **`.gitignore`**: optional `plans/derived/` (and/or `plans/*.json`).
4. **Workspace bootstrap**: mkdir `plans/`, `plans/derived/`.
5. **`src/plans/pipeline/`**: create + revise flows; DeepSeek reuse.
6. **UI**: Plans tab (view + edit flows that call PATCH); Todos tab (POST derived).
7. **Tests**: schema round-trip; reject invalid patch; revision/hash bump on save; derived stale detection.

---

## 7. Success criteria

- Same `planId` can be updated many times; `updatedAt` / `revision` / hash reflect changes.
- Invalid updates never hit disk (validation gate).
- Todo tab can detect stale derived data vs current plan.
- `schemaVersion` documents the **datatype** evolution; old files remain readable until migrated.

---

## 8. Follow-ups (post-MVP)

- Migration tool for `schemaVersion` bumps.
- Plan diff UI between `revision` values.
- Link `planId` from agent session events.
