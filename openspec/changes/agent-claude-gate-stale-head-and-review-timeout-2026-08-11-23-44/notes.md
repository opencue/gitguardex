# agent-claude-gate-stale-head-and-review-timeout-2026-08-11-23-44 (minimal / T1)

Branch: `agent/claude/gate-stale-head-and-review-timeout-2026-08-11-23-44`

Three defects that made `gx branch finish --gate-review` unusable on a real
shipping session (two Medusa submodule PRs, 2026-08-11):

1. `openPullRequest` skipped the push once a PR existed, so the gate reviewed a
   stale remote head and its own "fix the findings, rerun" loop never converged.
2. The review provider spawn had no timeout — the one uncapped subprocess in
   `pr-review.js`. Both providers are agents with tools, so a review ran 25+
   minutes with no verdict and no failure.
3. `is_local_branch_delete_error` missed gh's "failed to run git: fatal: '<base>'
   is already used by worktree", so a PR that MERGED was read as a failed merge
   and the flow polled for the full wait timeout.

Evidence, tests and reasoning are in the commit message.

## Handoff

- Handoff: change=`agent-claude-gate-stale-head-and-review-timeout-2026-08-11-23-44`; branch=`agent/claude/gate-stale-head-and-review-timeout-2026-08-11-23-44`; scope=`merge-gate: stale head, unbounded review, merge misclassification`; action=`continue this sandbox or finish cleanup after a takeover`.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/gate-stale-head-and-review-timeout-2026-08-11-23-44 --base main --via-pr --gate-review --review-provider claude --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
