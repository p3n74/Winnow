# UI Integration: Pane 2 Graph Tab

## Goal

Add Graph as a first-class view in Pane 2, alongside existing tabs.

Target tab row:
- `Agent`
- `Shell`
- `Docs`
- `Graph`

## Graph View Modes

Single graph canvas with mode presets:

1. **Architecture**
   - L0-L1 emphasis
   - workflows/domains/external systems

2. **Code Map**
   - L1-L2 emphasis
   - module/file structure and dependencies

3. **Function Flow**
   - L3 emphasis
   - symbol-level links, data flow, and call graph

## Controls

- zoom in/out
- edge-type filter chips
- confidence threshold slider
- show/hide AI inferred edges
- highlight user-locked corrections
- search bar (semantic + exact)

## Interaction Model

- click node -> details side panel
- double click node -> expand neighborhood
- right click node/edge -> correct, lock, deprecate, annotate
- "Reconcile" action -> trigger recap pass for selected scope

## Side Panel Fields

For node:
- kind/name/path/signature
- summary
- state + confidence
- incoming/outgoing key edges
- evidence snippets

For edge:
- kind and description
- source/target
- state + confidence
- evidence list
- correction history

## User Corrections UX

Correction actions:
- relink edge
- remove edge
- lock edge
- create manual edge
- rename summary

After save:
- apply immediately to working graph
- mark as `user_locked` where applicable
- queue recap process
- show recap status badge (pending/success/conflict)

## Performance Targets (v1)

- initial graph tab open: < 1.2s on medium repos
- zoom/expand interaction: < 150ms perceived latency
- semantic query response: < 500ms for top results

## API Endpoints (proposed)

- `GET /api/graph/summary` (L0 overview)
- `GET /api/graph/nodes/:id/neighbors?depth=...`
- `POST /api/graph/query` (semantic + filters)
- `PATCH /api/graph/corrections`
- `POST /api/graph/reconcile`
- `GET /api/graph/snapshots`
- `POST /api/graph/snapshot/checkout` (working graph reset from snapshot)
