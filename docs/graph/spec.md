# Graph Engine Spec (v1)

## Objective

Build a dynamic, multi-resolution project graph that maps:
- every file and symbol
- how they relate and depend on each other
- how data and workflows move through the codebase

The graph must be:
- AI-inferred by default
- editable by users
- continuously self-improving in the background
- isolated per project
- versioned by git commit snapshots

## Scope

This spec covers:
- graph entities and relation semantics
- AI inference and correction policies
- background rumination behavior
- query behavior for fast search/context retrieval

## High-level Model

The graph contains both deterministic and semantic layers:

1. **Structural layer** (deterministic)
   - project -> module -> file -> symbol containment
   - imports/dependencies
   - call links (best effort)
   - read/write/event edges (where detectable)

2. **Semantic layer** (AI)
   - workflow nodes
   - concept nodes
   - inferred relation edges
   - English summaries for every node/edge

## Priority and Authority Rules

When facts conflict:

1. **Code/runtime evidence** (hard ground truth)
2. **User-locked corrections** (business intent priority)
3. **AI inference** (soft, revisable)

Behavior:
- AI cannot silently overwrite user-locked corrections.
- AI must issue a recap/consistency report after correction application.
- If AI sees conflict with code, it flags inconsistency and suggests repair.

## Background Rumination ("Daydreaming")

When idle, the engine runs low-priority refinement passes:

- find low-confidence/high-impact edges
- detect stale relationships after refactor
- identify disconnected or orphaned workflow nodes
- run consistency checks between code structure and semantic graph
- propose or apply upgrades in working graph (never immutable snapshots)

Rumination outputs:
- confidence score updates
- candidate patches
- recap report entries

## Search and Retrieval Goals

The graph powers fast context retrieval:

- semantic search over summaries/concepts
- graph-neighborhood expansion by node/intent
- relationship path tracing (how A connects to B)
- progressive detail by zoom level

## Multi-resolution Levels

- **L0**: architecture map (domains/workflows/external systems)
- **L1**: module map
- **L2**: file map
- **L3**: symbol/function map with call/data edges

Zooming out collapses clusters; zooming in expands contained nodes and stronger edges.

## Out of Scope (v1)

- perfect language-specific parsing for every ecosystem
- runtime instrumentation dependency tracing
- cross-repo federated graph
