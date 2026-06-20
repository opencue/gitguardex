## Why

- `resolveBaseBranch` / `resolveFinishBaseBranch` fell back to the hardcoded `DEFAULT_BASE_BRANCH` (`dev`) when no base was explicitly given or configured. On repos whose real default is `main` (or `master`), the finish/PR flow then targeted a non-existent `dev`, breaking PR creation and merges.

## What Changes

- Add `detectDefaultBaseBranch(repoRoot)`: prefer the remote's symbolic `origin/HEAD`, then the first existing branch among `main` / `master` / `dev` (local or on origin), then fall back to `DEFAULT_BASE_BRANCH`.
- Wire it as the final fallback in `resolveBaseBranch` and `resolveFinishBaseBranch`.
- `resolveFinishBaseBranch` now honors the per-branch `branch.<source>.guardexBase` (recorded at branch-start) before the repo-wide configured base.
- Export `detectDefaultBaseBranch`; add focused tests (`test/git-base-branch.test.js`).

## Impact

- Surface: `src/git/index.js` base-branch resolution (used by finish / PR / inspect flows). Behavior changes ONLY on the no-config fallback path; explicit `--base` and configured base are unchanged.
- Risk: low. Zero new test failures vs base; new precedence covered by tests. Detection uses read-only git probes (`symbolic-ref`, `show-ref`).
