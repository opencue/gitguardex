# dmux-style cockpit — Phase 2: branded welcome screen

## Why

Phase 1 wired the dmux-style top-bar shortcuts (`[n]ew agent`,
`[t]erminal`, `[l]ogs`, `[p]rojects`). The welcome screen still shows
the original `gx` ASCII robot motif and lists only the legacy `n`/`t`/
`s` next-actions. To match the dmux look users asked for and to
advertise the new shortcuts on first launch, the welcome page needs a
proper gitguardex brand block and an updated next-actions list.

## What changes

- Replace the 5-line `GUARD_MOTIF` (`/ _)`, `/  gx  \`) with a 5-line
  ASCII `GUARDEX` wordmark plus a single `guarded multi-agent cockpit`
  strapline.
- Add `l logs` and `p projects` to the welcome screen's `Next actions`
  block so users see all four primary shortcuts immediately.
- Keep the existing box, status rows (Repo / Branch / Safety / Hooks /
  Locks / Agents), and shortcut block intact.

## Impact

- New constants `GITGUARDEX_BRAND` and `GITGUARDEX_STRAPLINE` in
  `src/cockpit/welcome.js`.
- 2 lines added to the next-actions block.
- Tests:
  - `renderWelcomePage snapshots the empty cockpit welcome strings`
    extended to assert `l logs`, `p projects`, and the strapline.
  - `renderWelcomePage stays width bounded and plain terminal safe`
    swaps the obsolete `/ _)` / `/  gx  \` motif assertions for the
    new strapline + brand-marker checks.
- ASCII-only constraint preserved (no unicode block or box-drawing
  chars, so plain terminals stay safe).
- No behavior change to safety model, branches, worktrees, locks, or
  PR-only finish flow.
