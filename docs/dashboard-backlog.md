# Dashboard / product backlog (Winnow UI)

This file tracks planned work discussed for the web console, without committing to a schedule.

## Shipped (console)

- **Last agent run** — Dashboard card backed by `GET /api/dashboard/last-agent-run` (usage DB: most recent `cursor-agent` run; shows status, exit, model, duration, tokens, paths, transcript base).
- **Disk & project sizes** — `GET /api/dashboard/disk` returns the **latest** measurement only (volume free/total via `statfs`, per–registered-project folder sizes; not persisted). UI: table + **Refresh** button.

## Agreed (do next, in principle)

_(Empty — next items move here from below when agreed.)_

## Shelved (explicitly later)

- **GitHub inbox / widget**  
  Deferred: needs a PAT and secure handling. Revisit after in-app env editing exists.

- **Settings: edit `.env` in the UI**  
  Build out the settings page so users can add/update key/value pairs (including secrets) and persist to `.env` without editing the file by hand. This unlocks later features that need tokens (e.g. GitHub) without ad-hoc file edits.

## Not pursuing (this round)

- Keyboard cheat sheet  
- Pricing / budget card  
- Local git snapshot card  
