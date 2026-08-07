## Why

`--gate-review` merged three PRs in `Webu-PRO/lifted.sk-storefront` — #463,
#465 and #466 — each carrying **zero reviews and zero comments**, after
announcing `enforcing review + CI gate before merge`. The reviewer itself was
fine: run by hand over #465's merged diff it produced four findings, two of
them real defects that had already shipped.

The gate treats an unposted review as a pass. `runPrReview` can return
`posted: false` — GitHub auth unavailable to the runner, or any path that
writes a local artifact instead of posting — and the gate only appends
`[not posted: …]` to a log line before promoting the PR and merging it.

That makes two failures indistinguishable from success:

- a provider that returned nothing looks exactly like a clean review;
- a verdict that never reached the PR leaves nothing to audit afterwards. The
  merge is recorded; the reasoning is not.

## What Changes

The gate now requires evidence. `!review.posted` throws instead of logging,
before `markReady`, so an unposted review neither promotes nor merges the PR.
The error names the cause (auth vs. a runner that reported not-posted) and the
local artifact path, so the operator can read what the provider actually said
before re-running or passing `--skip-review-gate`.

The success log now says `posted to the PR`, so the line means what it claims.

## Impact

- `src/finish/review-gate.js` — one guard.
- Every `runPrReview` stub across the gate test harnesses now returns
  `posted: true`, because they all stand for a review that reached the PR. The
  three new tests are the only ones that opt out. Without this the default stub
  silently modelled the broken case.
- 858 tests, 41 failures — byte-identical to the pre-change failing set, so no
  new failures. Those 41 are pre-existing.
- **This is a guard, not a root cause.** It closes the hole that let those
  three PRs through, and fails closed either way, but why the runner reported
  not-posted on that machine is still open: `gh auth status` succeeds in an
  interactive shell, so the likely difference is the environment the review
  subprocess inherits. Worth chasing separately.
