# Graph Schema v1

## Storage Strategy

Per-project storage under `.winnow/graph/`:

- `graph.db` - primary SQLite store (working graph + metadata)
- `snapshots/<commit_sha>.json.zst` - immutable frozen snapshots
- `working/` - optional materialized exports/debug artifacts

No global graph store. Each project is fully isolated.

## Core Tables (conceptual)

### `nodes`
- `id` TEXT PRIMARY KEY
- `kind` TEXT NOT NULL
- `name` TEXT NOT NULL
- `path` TEXT NULL
- `signature` TEXT NULL
- `summary_en` TEXT NULL
- `detail_level` TEXT NOT NULL (`L0|L1|L2|L3`)
- `tags_json` TEXT NOT NULL DEFAULT `[]`
- `state` TEXT NOT NULL DEFAULT `inferred`
- `confidence` REAL NOT NULL DEFAULT 0.5
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### `edges`
- `id` TEXT PRIMARY KEY
- `from_id` TEXT NOT NULL
- `to_id` TEXT NOT NULL
- `kind` TEXT NOT NULL
- `summary_en` TEXT NULL
- `weight` REAL NOT NULL DEFAULT 1.0
- `state` TEXT NOT NULL DEFAULT `inferred`
- `confidence` REAL NOT NULL DEFAULT 0.5
- `evidence_json` TEXT NOT NULL DEFAULT `[]`
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

### `node_attributes`
- `node_id` TEXT NOT NULL
- `key` TEXT NOT NULL
- `value_json` TEXT NOT NULL
- PRIMARY KEY (`node_id`, `key`)

### `edge_attributes`
- `edge_id` TEXT NOT NULL
- `key` TEXT NOT NULL
- `value_json` TEXT NOT NULL
- PRIMARY KEY (`edge_id`, `key`)

### `graph_meta`
- `key` TEXT PRIMARY KEY
- `value_json` TEXT NOT NULL

## Node Kinds

- `Project`
- `Domain`
- `Module`
- `File`
- `Symbol`
- `Workflow`
- `Concept`
- `DataEntity`
- `ExternalSystem`

## Edge Kinds

- `contains`
- `depends_on`
- `calls`
- `reads`
- `writes`
- `emits`
- `consumes`
- `defines`
- `implements`
- `drives`
- `uses_external`
- `related_to`

## State Enums

`state` for nodes/edges:
- `inferred`
- `user_locked`
- `system_verified`
- `deprecated`

## Confidence Convention

- `0.0-0.39`: weak
- `0.40-0.74`: medium
- `0.75-1.0`: strong

User-locked entities keep `state=user_locked`; confidence may still be tracked but does not permit automatic overwrite.

## Indexing

Recommended indexes:
- `nodes(kind, detail_level)`
- `nodes(path)`
- `edges(from_id, kind)`
- `edges(to_id, kind)`
- full-text index for `summary_en` and `name` (FTS5)

## Versioning

`graph_meta` keys:
- `schema_version`
- `project_root`
- `last_commit_snapshot_sha`
- `working_revision`
