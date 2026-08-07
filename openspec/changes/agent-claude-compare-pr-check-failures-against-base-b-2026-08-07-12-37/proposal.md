## Why

`gx branch finish --gate-review` requires **absolute green CI**
(`src/finish/review-gate.js`: any failed/cancelled check returns `checks-failed`).
In a repo whose base branch is already red, that gate can never pass — so every
ship needs a human to reproduce the comparison by hand: run the suite on base,
sort both failing-name sets, diff them, then merge with the gate bypassed.

That comparison is mechanical, and the gate should do it. The question a merge
gate actually needs to answer is not "is CI green?" but "does this change ADD a
failure?".

## What Changes

- `src/pr.js`
  - `getPullRequestStatus` now returns `failedNames`, so failures can be
    identified rather than only counted.
  - `checkOutcomes(repoRoot, ref)` returns `{ failing, total }` for a ref,
    covering check-runs and legacy commit statuses. `total` distinguishes "no
    checks ran" from "checks ran and passed".
  - `baselineFailures(repoRoot, base)` unions the failing names on the base
    branch HEAD with those on the head of the last merged PR into that base.
- `src/finish/review-gate.js` — `waitForGreenCi` accepts `baselineFailures`.
  When non-empty, failing checks whose names are all in the baseline no longer
  block, `UNSTABLE` joins the trusted merge states, and the no-verdict fallback
  accounts every check as success-or-cleared-failure.
- New flag `--gate-baseline` / `--no-gate-baseline` on `gx branch finish`,
  wired through both finish paths (`parseFinishArgs` and `splitGateReviewFlags`).

**Why the baseline unions two sources.** Reading only the base branch HEAD
returns nothing useful here: `ci.yml` triggers on `pull_request` only, so
`test (node 20)` never runs on `main`. `main` does carry one unrelated
check-run, which defeats any "does the base have checks?" heuristic — it answers
yes while the check that matters is absent. The last merged PR is the newest CI
verdict on what is now base code, so a failure there is by definition already in
the base. Verified live: the union reports `test (node 20)` for `main`, while
the base-only read returned `[]`.

## Impact

- Off by default; without `--gate-baseline` the gate behaves exactly as before.
- Safety is preserved in every direction that matters: pending checks still
  wait, ambiguous states still block, `BLOCKED`/`DIRTY`/`BEHIND` still block,
  an unnameable failure still blocks, and an unreachable API contributes an
  empty baseline (stricter, never looser).
- A check that failed on the last merged PR is whitelisted by name. That is the
  intended semantics — that PR is merged, so its failure is now the base's.
- Does NOT address the local `agent-preflight.sh` gate, which also requires
  `npm test` to exit 0 and so still needs `--no-preflight` in a baseline-red
  repo. That is the remaining half of the manual work.
