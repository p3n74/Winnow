# Graph Engine Rollout Plan

## Phase 0 - Foundations

- create graph docs/specs (this pack)
- align schema and lifecycle decisions
- confirm correction authority rules

Exit criteria:
- approved schema v1
- approved commit snapshot policy
- approved UI tab approach

## Phase 1 - Storage and Core Graph Service

Deliverables:
- `.winnow/graph/graph.db` initialization
- schema migration bootstrap
- repository scanner (project/module/file nodes)
- deterministic edges (`contains`, `depends_on`)
- graph read APIs

Exit criteria:
- graph builds for current project
- repeatable rebuild without corruption
- no cross-project leakage

## Phase 2 - Symbol and Relation Extraction

Deliverables:
- symbol extraction per supported language
- initial `calls`, `reads`, `writes`, `emits`, `consumes` edges
- confidence scoring primitives

Exit criteria:
- function-level map available for major code paths
- confidence visible in node/edge payloads

## Phase 3 - AI Inference and Rumination Loop

Deliverables:
- workflow/concept inference
- English summary generation for nodes/edges
- idle rumination worker with conflict queue
- recap pass after user correction

Exit criteria:
- inferred workflow graph usable
- recap reports generated reliably
- user-locked edits never auto-overwritten

## Phase 4 - Commit Snapshot Integration

Deliverables:
- commit-linked graph freeze pipeline
- immutable snapshot exports
- working graph rollover after commit
- snapshot listing API

Exit criteria:
- every new commit has graph snapshot
- working graph resumes from latest sealed snapshot

## Phase 5 - Graph UI Tab (Pane 2)

Deliverables:
- new `Graph` tab in pane 2
- multi-resolution rendering
- filters, search, details panel
- correction actions and reconcile UI

Exit criteria:
- graph is navigable at L0-L3
- user can correct relations and see recap status

## Phase 6 - Search Acceleration and Quality

Deliverables:
- semantic + neighborhood hybrid query
- ranking by confidence/evidence/intent
- quality metrics dashboard

Exit criteria:
- faster graph-assisted context retrieval
- stable result quality for common tasks

## Risks and Mitigations

- **Parser incompleteness**: start with best-effort + confidence tags.
- **Graph noise**: strict filters and confidence thresholds by default.
- **AI drift**: enforce user lock semantics + recap checks.
- **Performance**: incremental updates and bounded rumination budgets.

## Validation Checklist

- build graph from scratch
- run incremental update after file edits
- apply user correction and verify lock behavior
- run commit snapshot cycle
- open graph tab and verify zoom interactions
- run semantic query and inspect evidence trail
