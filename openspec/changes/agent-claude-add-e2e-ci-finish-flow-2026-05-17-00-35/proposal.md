## Why

- The repo has 78 unit tests but no CI job that exercises the full `gx branch finish --via-pr --wait-for-merge --cleanup` loop end-to-end as a black-box invocation of `bin/multiagent-safety.js`. Existing `test/finish.test.js` cases stub deep helpers; a single PR-time smoke that drives the real CLI against a local-only fixture is missing.
- Regressions in the finish pipeline (push -> `gh pr create` -> `gh pr merge` -> remote branch delete -> worktree prune -> local branch delete) are high-blast-radius for every agent in the field. Catching them at PR time is cheaper than a stalled-worktree report after merge.

## What Changes

- Add `test/e2e/finish-via-pr.sh`: a self-contained bash harness that creates a throwaway working repo + local bare origin, mocks `gh` via `GUARDEX_GH_BIN` so `pr merge` actually fast-forwards the bare remote, runs `gx setup` -> `gx branch start --tier T1 e2e-finish bot` -> trivial commit -> `gx branch finish --via-pr --wait-for-merge --cleanup`, and asserts: gh mock saw `pr create` + `pr merge`, the agent commit landed on `origin/main`, the local agent branch is gone, the remote agent branch is gone, the agent worktree directory was pruned, and finish output contains the `Merged ... via pr flow` success line.
- Add `.github/workflows/e2e-finish.yml`: a PR-scoped workflow (paths-filtered to `bin/**`, `src/finish/**`, `src/cli/**`, `src/git/**`, `scripts/openspec/**`, `templates/scripts/agent-branch-finish.sh`, `templates/scripts/agent-branch-start.sh`, `test/e2e/**`, and itself). 10-minute timeout. Mirrors `ci.yml` style: same Node 20, same `actions/checkout` / `actions/setup-node` pinned SHAs, draft-PR skip, concurrency cancel-in-progress. Always available via `workflow_dispatch`.

## Impact

- No source code changes under `src/`. Only adds `test/e2e/finish-via-pr.sh` and `.github/workflows/e2e-finish.yml`, plus the OpenSpec change artifacts.
- New workflow runs only when the PR touches finish-relevant paths, so it adds zero minutes for documentation- or unrelated-feature PRs.
- The harness is local-only: it never touches the real GitHub remote or the real `gh` CLI. The `gh` mock is path-injected via `GUARDEX_GH_BIN`.
- Risk: future changes to the finish PR-flow's `gh` command surface (e.g., new `pr view --json` fields) may require updating the mock. The harness fails fast with a descriptive `mock-gh: unsupported ...` error when that happens, so the failure mode is loud, not silent.
