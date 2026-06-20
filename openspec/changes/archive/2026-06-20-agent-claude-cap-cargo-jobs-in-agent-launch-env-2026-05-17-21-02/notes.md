# agent-claude-cap-cargo-jobs-in-agent-launch-env-2026-05-17-21-02 (minimal / T1)

Branch: `agent/claude/cap-cargo-jobs-in-agent-launch-env-2026-05-17-21-02`

Cap `CARGO_BUILD_JOBS` in the env prefix of every agent launch command so concurrent agent runs don't oversubscribe the host when child cargo builds fan out. Formula: `max(2, floor(os.cpus().length / 4))`. Harmless on non-Rust agents (env var is only read by cargo).

## Files

- `src/agents/launch.js` — new `buildResourceEnv()`, prepended to `buildSessionEnv()` in `buildAgentLaunchCommand`.
- `test/agents-launch.test.js` — expected `CARGO_BUILD_JOBS=<n>` is computed from `os.cpus()` (was hardcoded `=8`, only passed on 32-CPU hosts). Added a coverage test asserting the formula.
- `test/agents-start-dry-run.test.js` — regex relaxed to `CARGO_BUILD_JOBS=\d+`.
- `test/agents-start.test.js` — canonical-session `launchCommand` assertions updated to use the computed `CARGO` prefix.

## Verification

- `node --test test/agents-launch.test.js test/agents-start-dry-run.test.js test/agents-start.test.js` — 24/24 pass.
- `npm test` — 570 pass / 23 fail; failure count identical to clean `main` baseline (pre-existing, unrelated).

## Handoff

- Handoff: change=`agent-claude-cap-cargo-jobs-in-agent-launch-env-2026-05-17-21-02`; branch=`agent/claude/cap-cargo-jobs-in-agent-launch-env-2026-05-17-21-02`; scope=`cap CARGO_BUILD_JOBS in agent launch env`; action=`finish cleanup`.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/cap-cargo-jobs-in-agent-launch-env-2026-05-17-21-02 --base main --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
