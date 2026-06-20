# phase4-perf-hoist-agents-status-git-prob (minimal / T1)

Branch: `agent/claude/phase4-perf-hoist-agents-status-git-prob-2026-06-03-13-26`

Phase 4 of the gitguardex improvement plan: perf hot-paths. No observable behavior change. 4 files, +30/-12.

## Scope

- **B3** `agents/inspect.js` + `agents/status.js`: hoist the invariant `git worktree list --porcelain`
  out of the per-session loop in `buildAgentsStatusPayload`. Was fetched once per session inside
  `worktreePathForBranch` (~6N git spawns); now fetched ONCE via new `listWorktrees(repoRoot)` and
  threaded down through `changedFiles`/`inspectAgentBranch` via optional `options.worktrees`
  (~6N -> ~5N+1). Backward-compatible: callers that omit it (branchDiff/branchLocks/inspect cmd)
  fetch on demand, unchanged. Also hot via `cockpit/state.js` (re-renders each refresh).
- **B4** `cli/main.js` + `cli/commands/misc.js`: lazy-`require('../cockpit')` inside the two
  functions that use it (default-cockpit dispatch + `gx cockpit`), instead of eager top-level.
  Cockpit pulls 32 modules; now loaded ONLY when the cockpit actually renders.

## Deferred (not here)

- **B5** finish base-branch hoist (`finish/index.js`) — optimizes `resolveFinishBaseBranch`, the exact
  function the user's staged `detectDefaultBaseBranch` WIP rewrites. Pairs with Phase 5 once WIP lands.
- **cockpit/index.js spread narrowing** — export-surface cleanup, re-export risk, NO perf benefit
  (cockpit/index.js still requires control/actions when loaded). Defer to a dead-surface pass.

## Verification

- **B4 proven**: requiring `main.js` pulls **0** cockpit modules (was 32).
- **B3 structural**: `listWorktrees` fetched once at `status.js:90`, threaded into `worktreePathForBranch`.
  (Not benchmarked for N: 0 active sessions locally; e2e test `agents-status.test.js:143` exercises the
  hoisted real-array path end-to-end and passes.)
- `node --test`: failing set **byte-identical to base** (detached-snapshot diff, `comm` = 0 new / 0 fixed). 34 = baseline.
- Independent review: NO BLOCKING FINDINGS (null-handling, behavior equivalence, B4 completeness verified).

## Cleanup

- [ ] Gate satisfied manually (clean review + no-new-failures) per baseline-red-CI policy → land via `gx branch finish --wait-for-merge --cleanup`.
- [ ] Record PR URL + `MERGED`. Confirm sandbox pruned.
