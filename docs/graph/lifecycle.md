# Graph Lifecycle and Snapshot Policy

## Core Principle

Graph history mirrors git history.

On each commit:
1. freeze current working graph
2. persist immutable snapshot bound to commit SHA
3. clone latest snapshot into new working graph
4. continue AI rumination on working graph only

## State Machine

- `Working` (mutable)
- `Sealing` (commit in progress)
- `SealedSnapshot` (immutable)
- `WorkingNext` (new mutable copy)

## Commit Hook Behavior (target design)

Trigger at successful commit boundary:

1. Read current git commit SHA (`HEAD`)
2. Serialize working graph with metadata:
   - `commit_sha`
   - `created_at`
   - `schema_version`
   - `project_root`
3. Write snapshot to `.winnow/graph/snapshots/<sha>.json.zst`
4. Mark prior working revision sealed
5. Create new working revision initialized from sealed snapshot

If commit hook fails:
- do not corrupt working graph
- retry seal in background and log warning

## Rumination Boundaries

Rumination may:
- edit working graph
- create candidate patches
- adjust confidence and summaries

Rumination must never:
- mutate sealed snapshot files
- alter past commit snapshots

## User Corrections Lifecycle

When user edits graph:
1. write correction as `state=user_locked`
2. append correction event to audit log
3. trigger AI recap pass
4. if conflict detected, record issue and recommendation (no forced overwrite)

## Audit Trail (recommended)

Store under `.winnow/graph/audit/`:
- correction events
- recap reports
- rumination decisions
- conflict resolutions

This supports trust, reproducibility, and later debugging.

## Garbage Collection

Snapshots are immutable and can grow over time.

Retention options:
- keep all snapshots (default)
- optional compact mode:
  - keep all recent N
  - keep tagged releases
  - keep weekly checkpoints

GC must not run by default until explicitly enabled.
