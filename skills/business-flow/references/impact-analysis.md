# Change impact analysis

Use this mode when the user supplies a change request or asks which business flows a code change affects. Keep source inspection read-only unless implementation is separately requested. The calling model performs analysis; the offline HTML displays its result and does not send prompts to a model.

## Requirement preview

Read the requirement as proposed behavior, not evidence of existing behavior. Locate current implementations, validation rules, inputs/outputs, persistence and callers. Identify the direct changes needed, then inspect consumers and branches to decide which behavior might change. Reuse a graph only if its source hashes still match; otherwise refresh the relevant graph first. Mark `mode: requirement`, keep current behavior in the base graph, and explain the proposed difference in impact reasons. Do not claim code has changed or tests passed.

## After code changes

Use `mode: diff` only after reading an actual comparison. Resolve an explicit user baseline to a commit SHA; otherwise use HEAD for uncommitted changes. For a committed change with no clear baseline, ask for the intended base instead of silently assuming a release or branch. Record baseline SHA and target SHA (or `working-tree` plus the source hashes in the rendered snapshot).

Use read-only Git operations such as `git status --short`, `git diff --no-ext-diff --no-textconv --name-status <base>`, and `git diff --no-ext-diff --no-textconv --unified=3 <base> -- <relevant-path>`. Resolve/validate revision arguments before passing them; never interpolate raw user text into shell commands. Inspect staged and unstaged changes relative to base, plus relevant untracked files. Check renames and deleted lines against the baseline. Follow applicable ignore/privacy scope, not unrelated ignored files.

Re-read changed implementations and their callers/consumers, map changed symbols/line ranges to business nodes, and update the graph to current behavior. Filename overlap is a candidate, not proof that every node in that file is affected. For removed nodes and deleted-only evidence, record their old behavior/path and impact in the summary/limitations or a separate comparison note; do not attach nonexistent current-source references. Missing dependencies and unmapped changes must be listed. Do not rewrite old snapshot hashes to make stale references pass.

## Decide propagation

- Direct: implementation/rule/contract expected to change (preview), or whose behavior actually changed in the inspected diff.
- Indirect: a downstream input, acceptance condition, output, state, error, persistence, or consumer behavior that can change because of a direct change. Require a specific causal explanation and an existing directed path from a direct node. Use control edges when explaining execution order; reads have store → consumer direction.
- Stop propagation at unaffected contracts, branches and unrelated consumers. Reachability alone is not impact. Do not mark every downstream node merely because it is reachable.
- A node requiring regression checks is not necessarily a required code edit. State that distinction in its reason. Structural validation cannot prove semantic impact or exhaustiveness.
- Upstream callers that must themselves change are additional direct changes with their own evidence; do not reverse data-flow arrows to manufacture an impact path.

## Output

Add the optional `impact` object to a freshly validated graph and render a separately named report, e.g. `business-flow-impact.html`. Preserve the original overview report. The full contract is in [graph-format.md](graph-format.md). Include the exact request, mode, scope/uncertainties, itemized reasons/evidence, propagation paths, and actionable regression checks (mark them as recommendations unless actually executed).

Red solid node outlines mean direct impact; red dashed outlines mean indirect impact. Parent business nodes summarize affected child rules in overview mode. Only explicitly analyzed edges are highlighted red. The user can toggle impact markings and click “定位影响流程” to reveal detailed affected nodes. Nodes not marked red are not guaranteed unaffected.

Example invocation:

```text
Use business-flow to analyze this requirement without editing code:
Order quantity must be a positive integer; reject fractions while retaining the amount formula.
Show direct and indirect impact in red, with rule details, evidence and regression suggestions.
```

For post-change analysis:

```text
Use business-flow to analyze the actual code changes from <base-commit> to the current working tree.
Update the business graph, highlight affected flows in red, and list unmapped changes and tests to rerun.
```
