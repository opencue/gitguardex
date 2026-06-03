## Why

`gx branch finish --wait-for-merge` trusts server-side branch protection for the
actual merge and can fail open: it merged a PR to `main` while the full test
suite was red, because the shell `gh pr merge` runs the instant GitHub allows it
and nothing in the JS layer enforces "review clean + CI green" first. Teams that
want a real pre-merge gate had no way to get one from `gx` itself (only the
agent-driven `/autoship` flow enforced it).

## What Changes

- Add an **opt-in** merge gate to `gx branch finish`, activated by `--gate-review`
  (and on by default for `gx ship`). Default `gx branch finish` is unchanged, so
  existing flows and parallel agents are not disrupted.
- When enabled, before the shell merge runs, the gate: opens/pushes the PR (draft),
  runs the gitguardex AI review **fail-closed**, promotes to ready, waits for CI to
  settle **green**, and requires GitHub's own `mergeStateStatus` to be mergeable.
  Any failure throws and the merge is skipped for that branch.
- New flags: `--gate-review` / `--no-gate-review` / `--skip-review-gate`,
  `--review-provider <codex|claude>`, `--allow-no-checks`.

## Impact

- New module `src/finish/review-gate.js`; `src/pr.js` now surfaces
  `reviewDecision` + `mergeStateStatus`; `src/pr-review.js` adds
  `evaluateReviewGate` and fails closed on empty provider output.
- Behavior change is gated behind a flag (default OFF) -> zero impact on the
  existing default finish path.
- The gate requires a review provider (`codex`/`claude`) and, by default, at least
  one CI check; `--allow-no-checks` overrides the latter, `--skip-review-gate`
  bypasses the gate entirely.
- Risk: a strict gate could block a legitimate merge (e.g.
  `mergeStateStatus=UNSTABLE` from a non-required red check). Escape hatch:
  `--skip-review-gate`.
