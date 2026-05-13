## ADDED Requirements

### Requirement: agent-worktree-prune skips worktrees with live processes

The `agent-worktree-prune.sh` cleanup script SHALL NOT remove a managed agent worktree, nor delete its branch, while any live process on the host has its current working directory resolved to a path inside that worktree.

#### Scenario: Live process inside detached agent worktree preserves the worktree

- **GIVEN** a managed agent worktree at `<repo>/.omc/agent-worktrees/<slug>` is in detached-HEAD state and would otherwise satisfy the prune criteria
- **AND** a live process on the host has its cwd inside that worktree (as reported by `/proc/*/cwd`)
- **WHEN** `agent-worktree-prune.sh` runs against the parent repo
- **THEN** the worktree directory continues to exist after the run
- **AND** a `[agent-worktree-prune] Skipping live process worktree: <path>` line is emitted to stdout
- **AND** the `skipped_active` counter is incremented in the run summary
- **AND** regressions are covered by a `test/doctor.test.js` case that spawns a child process inside a detached worktree and asserts both the preservation and the log line.

#### Scenario: No /proc available falls back to legacy behavior

- **GIVEN** the host does not expose `/proc` (e.g., the script runs on a platform without procfs)
- **WHEN** `agent-worktree-prune.sh` runs
- **THEN** the live-process check returns false (fail-open)
- **AND** the rest of the prune flow proceeds exactly as it did before this change, so cleanup on non-Linux hosts is not permanently blocked.
