# agent-claude-add-guardex-auto-ship-opt-in-gated-auto-2026-06-29-08-28 (minimal / T1)

Branch: `agent/claude/add-guardex-auto-ship-opt-in-gated-auto-2026-06-29-08-28`

Add an opt-in `GUARDEX_AUTO_SHIP=1` env toggle so a bare `gx finish` / `gx branch finish`
defaults to the gated ship (open PR from worktree → wait for merge → cleanup, with the
clean-AI-review + green-CI merge gate). Lowers agent friction without weakening the guardrail:
the only default flipped is `gateReview` (via-pr / wait-for-merge / cleanup are already
defaults), and explicit flags (`--no-gate-review`, `--direct-only`) still override.

## Files

- `src/cli/args.js` — `parseFinishArgs` reads `GUARDEX_AUTO_SHIP` (via `envFlagIsTruthy`) and
  flips the `gateReview` default to `true` when set. Single insertion point: `gx finish`,
  `gx branch finish`, and `gx ship` all resolve options here.
- `test/auto-ship-toggle.test.js` — toggle on → resolves like `gx ship`; explicit `--no-gate-review`
  / `--skip-review-gate` win; toggle unset/falsy → defaults unchanged.
- `AGENTS.md` — documents the toggle + `gx ship` short form, and adds the "always offer to
  finish/merge" contract line.

## Verification

- `node --test test/auto-ship-toggle.test.js` → 4/4 pass.
- `npm test` → 718 pass / 27 fail / 1 skip; failing set byte-identical to base `main` (27 = 27,
  zero new failures — repo's `test` job is baseline-red).

## Handoff

- Handoff: change=`agent-claude-add-guardex-auto-ship-opt-in-gated-auto-2026-06-29-08-28`; branch=`agent/claude/add-guardex-auto-ship-opt-in-gated-auto-2026-06-29-08-28`; scope=`opt-in GUARDEX_AUTO_SHIP gated-finish toggle + docs`; action=`finish via gated PR`.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/add-guardex-auto-ship-opt-in-gated-auto-2026-06-29-08-28 --base main --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
