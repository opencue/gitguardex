## Why

The doctor auto-finish sweep (`autoFinishReadyAgentBranches`) merges ready
`agent/*` branches into the base branch automatically and **without any review
gate** — it shells `agent-branch-finish.sh` directly, bypassing the merge gate
that interactive `gx finish` runs. The opt-in `GUARDEX_AUTO_SHIP` toggle makes
`gx finish` enforce that gate (clean AI review + green CI), but the unattended
sweep still merged ungated, so the two paths diverged: opting into safe shipping
did not make the background sweep safe.

## What Changes

- When `GUARDEX_AUTO_SHIP` is truthy, the auto-finish sweep runs the same
  `runReviewGate` (review + green CI + GitHub-mergeable) before merging each
  branch via the PR path. A blocked gate skips that branch (records a `[skip]`
  detail) instead of merging.
- The gate applies only to the PR path. The direct/local fallbacks have no PR or
  CI to gate and pass through unchanged.
- When `GUARDEX_AUTO_SHIP` is unset/falsy, sweep behavior is unchanged.
- Implementation extracted into an injectable `runAutoShipGateForBranch` helper
  so the gate decision is unit-testable without a GitHub/`gh` fixture.
- `GUARDEX_AUTO_SHIP_REVIEW_PROVIDER` overrides the gate reviewer (default
  `codex`) so an unattended sweep does not permanently block when the default
  provider is unavailable.

## Impact

- Affected surface: `src/doctor/index.js` (auto-finish sweep). New test
  `test/auto-finish-sweep-gate.test.js`.
- Behavior change is opt-in (gated behind `GUARDEX_AUTO_SHIP`); default off =
  no change.
- Cost note: with the toggle on, `gx doctor`'s sweep runs an AI review + green-CI
  wait per ready branch. That is the intended trade for closing the ungated
  auto-merge-to-main hole; users who do not want it leave `GUARDEX_AUTO_SHIP`
  unset (or set `GUARDEX_SKIP_AUTO_FINISH_READY_BRANCHES=1`).
