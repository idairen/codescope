# Graph contract (version 1)

UTF-8 JSON. Required fields:

- `version`: integer `1`.
- `title`: report title.
- `scope`: what source was actually inspected and what journey is covered.
- `limitations`: list of strings, including uninspected scope and static-analysis limits.
- `questions`: list of unresolved business questions (may be empty).
- `nodes`: 1–160 nodes; at least one `core: true`.
- `edges`: 0–400 directed relations. Disconnected nodes are allowed; do not add unsupported edges.

Node fields: `id` (unique nonempty string), `label`, `kind` (`actor`, `process`, `data`, `store`, `outcome`, `rule`), `summary`, `core` (boolean), `inputs`, `outputs`, `states` (string arrays), `evidence` (nonempty reference array).

Edge fields: `id` (unique), `source`, `target` (existing node IDs), `label` (data transferred or action), `status` (`supported` or `inferred`), `reason` (why the evidence supports the relation, or why it remains a hypothesis), `evidence` (nonempty reference array). Different directed relations between the same nodes are allowed. Cycles and self loops are allowed.

## Optional business-logic detail layer

This is a backward-compatible version 1 extension. Existing graphs without these fields remain overview-only. For new analyses, extract both overview and detailed logic wherever source evidence permits.

- Node `layer`: `business` (default) or `detail`. Detail nodes require `core: false` and `parentId` referencing an existing business-layer `process`. The parent is an ownership/grouping relation, never an implied execution edge. Nested detail parents are not supported.
- A `rule` node must be in the detail layer and include `rule: {"condition": "Boolean(input.sku)", "onPass": "Continue quantity validation", "onFail": "Throw invalid-order error; no write"}`. `condition` evaluates true on the pass branch. Keep the exact comparison/coercion/null/short-circuit semantics; describe any simplification. Every rule requires outgoing `branch: "pass"` and `branch: "fail"` edges with source evidence. A failure may mean skip, default or retry rather than throw: describe the implementation.
- Calculations, normalization, data writes and error outcomes may also be detail nodes (`process`, `data`, `store`, `outcome` as appropriate); include formulas and state effects in summary/inputs/outputs/states. Do not create imaginary rules to fill a template.
- Edge `view`: `both` (default), `overview` or `detail`. Any edge touching a detail node must be `detail`. When detailed paths replace a summary relationship, mark that summary edge `overview` so it does not falsely bypass validation. Use `both` only when the relationship remains independently correct in both views.
- Edge `flow`: `data` (default) or `control`. A read/write payload is data flow. Execution order, conditional continuation, rejection and early return are control flow. `branch` is optional (`pass` or `fail`), allowed only on control edges originating from a rule. Data edges conditioned on successful validation must explain that prerequisite in their label/reason.

The viewer defaults to overview. “包含业务逻辑校验” enables detail nodes and detailed relations. Selecting a business process in both-directions mode also opens its owned details; selecting a rule uses the normal one/two-hop directed neighborhood. Direction-only filters use strict graph traversal. Turning details off maps a focused detail node back to its owning process and removes detail nodes from search and canvas. Old reports display an explicit message when they contain no extracted rules.

Evidence: `path` (repository-relative POSIX path, no `..`, absolute paths or symlinks), `startLine`, `endLine` (one-based inclusive integers). Reference source code for implemented behavior, docs for intent. Do not quote source bodies into the graph. Optional `sourceHashes` maps referenced relative paths to SHA-256 of the entire file; the renderer fills this in the snapshot and verifies existing hashes.

Minimal shape (replace example references with real inspected code):

```json
{
  "version": 1,
  "title": "Order creation",
  "scope": "Order handler and its memory repository",
  "limitations": ["Source interpretation; no runtime trace"],
  "questions": [],
  "nodes": [
    {
      "id": "create",
      "label": "Create order",
      "kind": "process",
      "summary": "Validate and save an order",
      "core": true,
      "inputs": ["Order request"],
      "outputs": ["Saved order"],
      "states": [],
      "evidence": [{ "path": "src/orders.ts", "startLine": 4, "endLine": 9 }]
    },
    {
      "id": "orders",
      "label": "Orders",
      "kind": "store",
      "summary": "In-memory orders",
      "core": false,
      "inputs": ["Order"],
      "outputs": ["Stored order"],
      "states": ["created"],
      "evidence": [{ "path": "src/repository.ts", "startLine": 1, "endLine": 7 }]
    }
  ],
  "edges": [
    {
      "id": "save",
      "source": "create",
      "target": "orders",
      "label": "Save order",
      "status": "supported",
      "reason": "createOrder calls saveOrder; saveOrder writes the orders map",
      "evidence": [
        { "path": "src/orders.ts", "startLine": 8, "endLine": 8 },
        { "path": "src/repository.ts", "startLine": 3, "endLine": 6 }
      ]
    }
  ]
}
```

Use stable business IDs across regenerations where meaning is unchanged. Do not equate `supported` with formal proof: it means the analyzing agent found supporting evidence. The validator checks structural and source integrity, not semantic truth. Keep JSON and HTML together if the report must be rechecked later. Reports include business information and internal paths; share them only within the user's intended scope.
