# phase7-dedupe-identical-sandbox-helpers (minimal / T1)

Branch: `agent/claude/phase7-dedupe-identical-sandbox-helpers-2026-06-03-15-01`

The safe slice of the deferred A3 follow-up: `cli/shared/sandbox.js` carried byte-identical
copies of 5 helpers that already live in `src/sandbox/index.js`. Delegate them via a
destructure from `sandboxModule` (already required) and delete the local copies — one source
of truth, no behavior change.

## Scope

- `src/cli/shared/sandbox.js`: `const { protectedBaseWriteBlock, extractAgentBranchStartMetadata,
  resolveSandboxTarget, isSpawnFailure, cleanupProtectedBaseSandbox } = sandboxModule;` and removed
  the 5 local definitions (~100 LOC). Re-exports unchanged (now resolve to the imported copies), so
  test seams keep working.

## NOT done (deferred, evidence-based)

- The 2 genuinely-DRIFTED helpers (`buildSandboxSetupArgs` has `--contract`/`appendForceArgs`;
  `startProtectedBaseSandbox` has extra `path.resolve`) are NOT delegated — cli/shared has newer logic;
  reconciling which version is canonical is a behavior decision, not a mechanical dedup.
- `assertProtectedMainWriteAllowed` already delegates (no action).

## Verification

- `node --test test/*.test.js`: 33 failures = post-Phase-5 baseline (detached-snapshot diff: zero new).
  The 5 helpers byte-identical (md5) pre-merge. Module loads; all 5 still exported as functions.

## Cleanup

- [ ] `gx branch finish --branch agent/claude/phase7-dedupe-identical-sandbox-helpers-2026-06-03-15-01 --base main --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED`; confirm worktree pruned.
