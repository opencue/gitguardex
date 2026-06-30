## Why

Multi-agent worktree recovery had three gaps that strand state and block agents:

- `scripts/agent-stalled-report.sh` (a `SessionStart` hook) wrapped `scripts/agent-autofinish-watch.sh`, but that watcher was **never authored**, so the hook soft-exited 0 and merged-PR worktrees (the "retained for now" path in `agent-branch-finish.sh`) were never reaped.
- File locks recorded `claimed_at` but had no expiry. A lingering-but-idle worktree (crashed or forgotten lane) keeps blocking other agents on its files forever.
- `gx finish --all` finished each lane but never swept merged-but-stranded worktree dirs whose branch merged out-of-band.

## What Changes

- Add `scripts/agent-autofinish-watch.sh`: scans agent worktrees, reports stalled lanes (work present, no open PR, past idle gate) and merged-but-retained lanes, and under `--auto-merge` reaps merged lanes via the existing `gx worktree prune` primitive. Resolves the primary checkout via the git common dir; healthy in-flight lanes stay silent.
- Add `gx locks reap`: clears locks from worktrees idle past a TTL (`--ttl-hours` / `GUARDEX_LOCK_TTL_HOURS`, default 7d) with no live process inside. A blocked `claim` against a past-TTL lock now hints at `reap`.
- `gx finish --all` sweeps merged orphans after a fully-successful run (opt-out `--no-sweep-orphans`, never on dry-run), gated by the pure `shouldSweepOrphans` predicate.

## Impact

- Affected surfaces: `scripts/agent-autofinish-watch.sh` (new), `templates/scripts/agent-file-locks.py`, `src/finish/index.js`, `src/cli/args.js`, `.agent/STALLED-WORKTREE-RECOVERY.md`.
- Conservative by design: `--auto-merge` only reaps **merged** lanes; it does not auto-commit/push/PR un-reviewed work. Finishing un-PR'd lanes stays a reported manual action.
- Follow-up (out of scope here, blocked by a foreign lock on `src/cli/commands/claude.js`): distribute the watcher + `agent-stalled-report.sh` to target repos (pair into `templates/scripts/`, register in `MANAGED_TEMPLATE_DESTINATIONS`, add the report to `MANAGED_HOOK_FILES`). The new `gx locks reap` can clear that very stale lock once it ages out.
