## MODIFIED Requirements

### Requirement: Primary checkout cannot be silently switched during agent sessions
The `post-checkout` hook SHALL print a `[agent-primary-branch-guard]` warning
when the primary working tree (where `git-dir == git-common-dir`) is switched
AWAY from a protected branch (`main`, `dev`, `master`, or any branch listed
in `multiagent.protectedBranches`) during an agent session. Agent sessions
are detected via the presence of any of: `CLAUDECODE`,
`CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`, `OMX_SESSION_ID`, or
`CODEX_CI=1`. If the working tree is clean, the hook SHALL auto-revert the
primary checkout to the previous protected branch. If the working tree is
dirty, the hook SHALL NOT stash changes and SHALL NOT switch branches again.

#### Scenario: Agent session triggers auto-revert on clean tree
- **GIVEN** the primary checkout is on `main` and the tree is clean
- **AND** `CLAUDECODE=1` is exported
- **WHEN** the user or an agent runs `git checkout -b feature/x`
- **THEN** the `[agent-primary-branch-guard]` warning appears on stderr
- **AND** the primary checkout is returned to `main`.

#### Scenario: Dirty tree skips auto-revert
- **GIVEN** the primary checkout is on `main` with uncommitted edits
- **AND** an agent session is detected
- **WHEN** `git checkout feature/x` runs
- **THEN** the hook prints a `Working tree dirty — auto-revert skipped`
  message with a manual recovery hint
- **AND** the branch is NOT reverted so no uncommitted work is lost
- **AND** no `guardex-auto-revert` stash is created.
