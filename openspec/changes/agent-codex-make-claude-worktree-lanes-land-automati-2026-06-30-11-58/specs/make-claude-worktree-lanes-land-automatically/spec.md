## ADDED Requirements

### Requirement: Claude Stop hook lands agent worktrees
Guardex SHALL install a Claude `Stop` hook that attempts to finish the current lane when Claude stops inside an `agent/*` worktree with committed or dirty work.

#### Scenario: Committed agent worktree is handed to finish flow
- **GIVEN** Claude stops with `cwd` inside an `agent/*` worktree
- **AND** the worktree has commits ahead of its resolved base branch
- **WHEN** the `Stop` hook runs
- **THEN** Guardex SHALL invoke `gx branch finish --branch <branch> --base <base> --via-pr --wait-for-merge --cleanup`.

#### Scenario: Dirty worktree follows configured mode
- **GIVEN** Claude stops with `cwd` inside an `agent/*` worktree that has uncommitted changes
- **WHEN** `GUARDEX_CLAUDE_STOP_FINISH=clean`
- **THEN** Guardex SHALL leave the sandbox open and print the exact finish command.
- **WHEN** `GUARDEX_CLAUDE_STOP_FINISH` is unset or set to commit mode
- **THEN** Guardex SHALL delegate to the existing finish flow, which owns auto-commit, PR, merge wait, and cleanup.

#### Scenario: Stop hook stays fail-open
- **WHEN** the hook runs outside an `agent/*` worktree, during a recursive Stop hook invocation, or with no local work to finish
- **THEN** Guardex SHALL exit successfully without invoking the finish flow.
- **WHEN** the finish flow fails
- **THEN** Guardex SHALL keep the sandbox and print the retry command without failing Claude's Stop hook.
