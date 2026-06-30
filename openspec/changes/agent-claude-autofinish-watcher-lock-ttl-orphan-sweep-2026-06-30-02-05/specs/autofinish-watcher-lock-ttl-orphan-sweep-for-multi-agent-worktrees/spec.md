## ADDED Requirements

### Requirement: Stalled-lane watcher
The system SHALL provide `scripts/agent-autofinish-watch.sh`, which the `SessionStart` shim `scripts/agent-stalled-report.sh` invokes, to detect stalled agent worktrees and reap merged-but-retained lanes. It SHALL resolve the primary checkout via the git common dir so it operates correctly from inside any worktree, and SHALL emit a `[agent-autofinish-watch] agent/<branch>: <status>` line only for actionable lanes.

#### Scenario: Stalled lane is reported
- **WHEN** an agent worktree has committed or uncommitted work, no open PR, and is idle past the idle gate
- **THEN** the watcher prints an actionable `agent/<branch>: ... -> needs finish` line
- **AND** a healthy in-flight lane (open PR or a live process) produces no line.

#### Scenario: Merged lane is reaped under --auto-merge
- **WHEN** an agent branch's PR has merged but its worktree is still on disk
- **THEN** the watcher reports the lane as `prunable`
- **AND** with `--auto-merge` (and not `--dry-run`) it delegates to `gx worktree prune --include-pr-merged --delete-branches` to remove it.

### Requirement: Stale lock reaping
The `gx locks` tool SHALL provide a `reap` subcommand that clears file locks held by abandoned worktrees: present on disk, idle beyond a TTL (`--ttl-hours`, `GUARDEX_LOCK_TTL_HOURS`, default 7 days), and with no live process inside. It SHALL never clear locks from a worktree that has a live process, and a blocked `claim` against a past-TTL lock SHALL surface a hint pointing at `gx locks reap`.

#### Scenario: Abandoned lock is reaped
- **WHEN** `gx locks reap` runs and a sibling worktree holds a lock older than the TTL with no live process
- **THEN** that lock entry is removed from the sibling worktree's lock file
- **AND** `--dry-run` reports the same lock without removing it.

#### Scenario: Active lock is preserved
- **WHEN** a lock is within the TTL, or its worktree has a live process
- **THEN** `reap` leaves the lock in place.

### Requirement: Bulk-finish orphan sweep
`gx finish --all` SHALL sweep merged-but-stranded worktree dirs after the per-lane loop, only when every lane succeeded, never on a dry run, and opt-out via `--no-sweep-orphans`. The sweep SHALL be best-effort: a sweep failure warns but does not fail the finish.

#### Scenario: Sweep fires after a successful bulk finish
- **WHEN** `gx finish --all` completes with no failed lanes and `--no-sweep-orphans` is not set
- **THEN** it runs `gx worktree prune --include-pr-merged --delete-branches`
- **AND** with `--no-sweep-orphans`, `--dry-run`, a single-branch finish, or any failed lane, the sweep does not run.
