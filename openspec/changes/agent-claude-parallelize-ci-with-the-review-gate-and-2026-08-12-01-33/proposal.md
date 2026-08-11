## Why

`gx branch finish --gate-review` costs the operator two waits back to back. The
gate opens the PR as a draft so CI stays parked, runs the AI review to
completion, and only then promotes the PR and starts waiting for CI. Wall clock
is therefore `review + CI` where it could be `max(review, CI)`.

Measured on this repo (2026-08-12, PR flow on `main`):

| Phase | Time |
|---|---|
| push + open draft PR | ~7s |
| provider startup through a PATH shim | ~30s |
| AI review | minutes |
| CI (`CI` + `e2e (finish flow)` jobs) | ~2m11s |

The CI leg is pure serial overhead: nothing about it depends on the review's
verdict, only the merge does.

Two smaller costs sit next to it. The review always runs the provider's default
model, so a bounded diff review cannot be routed to a faster one. And the
provider is invoked by bare name, so whatever PATH resolves — including a
profile launcher or wrapper script — pays its startup on every review round.

## What Changes

- The gate promotes the PR to ready **before** the review instead of after, so
  CI and the review run at the same time. Merge still requires both to pass.
- `--gate-serial-ci` restores the previous ordering for callers who would rather
  spend the wall clock than spend CI minutes on a PR the review may block.
- The CI wait can be pinned to a specific commit (`expectHeadSha`). With
  `--gate-autofix`, the gate pins it to the commit the fix round pushed, so a
  rollup still describing the replaced commit can never read as green.
- `--review-model` / `GUARDEX_REVIEW_MODEL` select the review model.
- `GUARDEX_REVIEW_CLAUDE_BIN` / `GUARDEX_REVIEW_CODEX_BIN` select the binary
  that runs the review, so a slow PATH shim can be bypassed.

## Impact

- **Affected surfaces**: `src/finish/review-gate.js`, `src/pr-review.js`,
  `src/pr.js` (adds `headSha` to the status snapshot), `src/cli/args.js`,
  `src/cli/commands/branch.js`.
- **Behavior change, opt-out available**: a blocked review now leaves a promoted
  PR with CI having run. Nothing merges — `runReviewGate` still throws — but the
  PR is no longer a draft afterwards. `--gate-serial-ci` opts out.
- **New risk closed, not opened**: promoting early means CI can start on a
  commit an auto-fix later replaces. The `expectHeadSha` pin makes that case
  fail closed (`stale-head`) rather than merge a green belonging to the old
  commit.
- **Defaults unchanged elsewhere**: with no `--review-model` and no env knobs,
  the provider, model, and binary resolve exactly as before.
