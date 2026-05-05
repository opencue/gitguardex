# Tasks

## 1. Spec
- [x] 1.1 Capture proposal in `proposal.md`
- [x] 1.2 Capture spec delta in `specs/cockpit-welcome/spec.md`

## 2. Tests
- [x] 2.1 Extend the empty-welcome snapshot test to assert `l logs`,
       `p projects`, and the `guarded multi-agent cockpit` strapline.
- [x] 2.2 Replace the obsolete `/ _)` / `/  gx  \` motif assertions
       in the width-bounded test with strapline + brand-marker checks.

## 3. Implementation
- [x] 3.1 Replace `GUARD_MOTIF` with `GITGUARDEX_BRAND` (5-line ASCII
       wordmark for `GUARDEX`).
- [x] 3.2 Add `GITGUARDEX_STRAPLINE = 'guarded multi-agent cockpit'`.
- [x] 3.3 Wire the new brand and strapline into `renderWelcomePage`
       in place of `GUARD_MOTIF.forEach(...)`.
- [x] 3.4 Add `l logs` and `p projects` rows to the `Next actions`
       block.

## 4. Cleanup
- [ ] 4.1 Commit changes on the agent branch.
- [ ] 4.2 Push branch and open a PR.
- [ ] 4.3 Run `gx branch finish ... --via-pr --wait-for-merge --cleanup`.
- [ ] 4.4 Record PR URL and `MERGED` evidence.
