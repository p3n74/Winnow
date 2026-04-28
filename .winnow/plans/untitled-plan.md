# Winnow Planning and Efficiency Module

## Goal

- Build a dedicated planning and ticketing workflow in Winnow with clear plan scoping across agent sessions.
- Keep Dashboard focused on monitoring, and use Main Grid for operational controls and plan management views.
- Ensure plans are agent-managed and can be shared to GitHub issues later.

## Completed

- [x] Added `/api/system/live`, `/api/system/timeseries`, and `/api/system/advisories`.
- [x] Added telemetry/advisor stores and tests.
- [x] Added managed process APIs (`/api/processes/*`) with list/start/stop/log behavior.
- [x] Added Pane 2 `Plans` tab with list/create/load.
- [x] Added sqlite-backed plan metadata (`plans` table) with markdown files under `.winnow/plans/`.
- [x] Added Agent plan selector and prompt preamble injection for selected plan context.
- [x] Made plan editing agent-managed (UI read-only rendered markdown).
- [x] Added timeline/tree-capable plan graph visualizer with pan/zoom/fullscreen controls.
- [x] Added "Open in Agent" action from Plans tab and shared plan-selection persistence.
- [x] Added plan structure normalization flow (`Normalize now`) and normalize API route.
- [x] Refined graph styling for optional sidequests with priority tiers (p3+ lighter/dashed/italic + p-badge).
- [x] Canonical markdown format preserves nested sidequest subtree indentation through normalize.
- [x] Added Timeline vs Tree graph mode toggle per plan (persists in localStorage).
- [x] Added GitHub issue mapping fields per plan task (id, state, URL) via `plan_task_mappings` table and `/api/plans/:id/tasks` + `/tasks/:key/github` routes.
- [x] Added one-click "sync selected tasks to GitHub Issues" (`/api/plans/:id/github/sync`, dry-run + per-row save in UI).
- [x] Added reconcile flow with conflict hints (markdown vs stored mappings) via `/api/plans/:id/reconcile` and Reconcile button.

## In Progress

- [ ] Polish GitHub sync UX (per-row inline status, repo auto-detect, batch progress).

## Next Tasks

- [ ] Persist Timeline vs Tree mode per-plan (server-side) instead of just per-browser.
- [ ] Surface mapped issue state badges directly inside the plan graph nodes.
- [ ] Add tests for `parseTasksFromMarkdown` and `reconcilePlan`.
- [ ] Map heading sections (not just tasks) to GitHub milestones (optional).
  - [ ] Sidequest: auto-detect repo from `git remote` when `repo` field is empty.

## Validation Checklist

- [ ] Select this plan in Agent and run a prompt; confirm context appears in agent run status.
- [ ] Open Main Grid -> Plans tab; confirm plan loads rendered markdown and graph view toggles correctly.
- [ ] Confirm title rename persists across refresh/reload and does not revert.
- [ ] Confirm `Open in Agent` carries selected plan into Agent selector.
- [ ] Confirm `Normalize now` converts non-canonical plans into graph-ready structure.
- [ ] Confirm `/api/plans`, `/api/plans/:id` load data from sqlite metadata + markdown file.

## Current Scope

- Add system telemetry and efficiency advisories (CPU, memory, battery, thermal) with persistence.
- Add managed process tracking in Main Grid for project-relevant commands and logs.
- Add Pane 2 Plans tab with markdown-backed plans and sqlite metadata.
- Add plan selector in Agent so prompts are scoped to the selected plan context.

## Notes

- This plan is intentionally broad for active development and can be split into smaller plans once graph/tree + GitHub sync are implemented.
