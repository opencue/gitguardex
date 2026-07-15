## Why

- `gx branch finish --via-pr` opened the PR ready (never draft) and ran an
  unconditional immediate `gh pr merge` right after `gh pr create`. On a repo
  with no blocking checks the PR landed instantly.
- `--no-auto-promote` only skipped promoting a pre-existing draft; it did not
  hold the merge. A user who wanted to run an e2e gate before the merge had no
  working way to stop the auto-merge (observed in production: a PR merged
  before its e2e run; the flag the user reached for was inert).
- `docs/preflight.md` already described a draft-first flow the implementation
  never had.

## What Changes

- `--no-auto-promote` becomes a **merge hold** in `agent-branch-finish.sh`:
  - the PR is created with `--draft` (ready fallback when the plan does not
    support drafts; the hold still applies),
  - `run_pr_flow` early-returns before the immediate `gh pr merge`, the
    auto-merge enable, and the merge-wait polling,
  - the hold forces the PR path: `--direct-only` is refused, `--mode auto` is
    upgraded to `pr`,
  - the held finish exits 0 with branch, remote branch, and worktree retained,
    and prints how to lift the hold (`gh pr ready` + rerun finish).
- Default behavior (auto-promote on) is unchanged: create ready PR → merge →
  cleanup.
- `docs/preflight.md` documents the merge hold; static invariants added to
  `test/finish-preflight-flag.test.js`; new e2e `test/e2e/finish-merge-hold.sh`
  wired into `.github/workflows/e2e-finish.yml`.

## Impact

- Surfaces: `templates/scripts/agent-branch-finish.sh` (PR flow),
  `docs/preflight.md`, `test/finish-preflight-flag.test.js`,
  `test/e2e/finish-merge-hold.sh`, `.github/workflows/e2e-finish.yml`.
- Risk: low for default flows (no change when auto-promote is on, proven by
  the existing `finish-via-pr.sh` e2e). Behavior change only for callers who
  passed `--no-auto-promote` and relied on the merge landing anyway — that
  reliance was the bug.
- Rollout: none; target repos pick the script up via normal template
  distribution.
