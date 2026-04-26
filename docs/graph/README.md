# Project Graph Docs

This directory defines Winnow's project-level AI dependency graph system.

The graph is not limited to code imports or call graphs. It models:
- architecture
- workflows
- symbols and files
- data movement
- concepts and external systems

It is AI-inferred first, user-correctable, and continuously improved by an idle "rumination" process.

## Documents

- `spec.md` - canonical product and system spec
- `schema-v1.md` - graph data model and storage schema
- `lifecycle.md` - snapshot and commit lifecycle
- `ui-integration.md` - Pane 2 Graph tab UX and interactions
- `rollout-plan.md` - phased implementation plan and checkpoints

## Non-negotiable Rules

1. **Project isolation**: no cross-project contamination.
2. **User correction priority**: user intent can override AI inference when business logic differs.
3. **Code/evidence grounding**: AI must reconcile corrections with real code and report mismatches.
4. **Commit snapshots**: each git commit freezes an immutable graph snapshot.
5. **Working graph continuity**: post-commit AI refinement only mutates the working copy.
