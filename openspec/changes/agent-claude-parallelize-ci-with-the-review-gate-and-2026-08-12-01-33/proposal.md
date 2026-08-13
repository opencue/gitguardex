## Why

`gx branch finish --gate-review` costs the operator two waits back to back when
it uses the safest ordering. The gate opens the PR as a draft so CI stays
parked, runs the AI review to completion, and only then promotes the PR and
starts waiting for CI. Wall clock is therefore `review + CI`; callers may
explicitly opt into `max(review, CI)` when their repository has other merge
protection.

Measured on this repo (2026-08-12, PR flow on `main`):

| Phase | Time |
|---|---|
| push + open draft PR | ~7s |
| provider startup through a PATH shim | ~30s |
| AI review | minutes |
| CI (`CI` + `e2e (finish flow)` jobs) | ~2m11s |

The CI leg is mostly serial overhead, but draft state is also the only
GitHub-side hard barrier this local gate controls before the review verdict.

Two smaller costs sit next to it. The review always runs the provider's default
model, so a bounded diff review cannot be routed to a faster one. And the
provider is invoked by bare name, so whatever PATH resolves — including a
profile launcher or wrapper script — pays its startup on every review round.

## What Changes

- The gate keeps the PR draft while the review runs by default. If an existing
  PR is already ready, the gate redrafts it before invoking the review provider.
- `--no-gate-serial-ci` promotes the PR to ready **before** the review for
  callers who explicitly prefer parallel CI/review wall clock over the draft
  merge barrier. Merge still requires both to pass.
- The CI wait can be pinned to a specific commit (`expectHeadSha`). With
  `--gate-autofix`, the gate pins it to the commit the fix round pushed, so a
  rollup still describing the replaced commit can never read as green.
- Review/fix provider invocations resolve the real `claude`/`codex` binary by
  default, skipping Cue's `cue launch ...` shims and `codex-guard`; explicit
  `GUARDEX_REVIEW_CLAUDE_BIN` / `GUARDEX_REVIEW_CODEX_BIN` overrides still win.
  Claude invocations also run with `--safe-mode` so local hooks, MCP servers,
  and project customizations cannot stall the noninteractive review subprocess.
- GitHub API calls that need a `repos/<owner>/<name>/...` route resolve the
  canonical repository slug with `gh repo view` first. This avoids a moved
  remote making `gh api repos/:owner/:repo/...` write calls fail with HTTP 307.
- `--review-model` / `GUARDEX_REVIEW_MODEL` select the review model.
- `--review-timeout-ms` forwards a shorter provider timeout through the merge
  gate, matching `gx pr-review --timeout-ms`.

## Impact

- **Affected surfaces**: `src/finish/review-gate.js`, `src/pr-review.js`,
  `src/pr.js` (adds `headSha` to the status snapshot and canonical GitHub API
  routes), `src/github-api.js`, `src/cli/args.js`, `src/cli/commands/branch.js`.
- **Safe default, fast opt-in available**: a blocked review leaves the PR draft
  by default. `--no-gate-serial-ci` opts into the faster ready-before-review
  ordering when the repository has another trusted merge barrier.
- **Stale-CI risk closed**: in the opt-in parallel path, CI can start on a
  commit an auto-fix later replaces. The `expectHeadSha` pin makes that case
  fail closed (`stale-head`) rather than merge a green belonging to the old
  commit.
- **Provider startup is safer by default**: with no env knobs, a PATH that starts
  with Cue shims now resolves to the real provider binary behind them instead of
  recursively booting a full profiled agent.
