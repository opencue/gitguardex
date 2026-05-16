## ADDED Requirements

### Requirement: post-checkout hook is installed and executable
Every repo that runs `gx setup` or `gx doctor` SHALL have an executable
`.githooks/post-checkout` file whose content matches
`templates/githooks/post-checkout` byte-for-byte. The installer
(`scripts/install-agent-git-hooks.sh`) SHALL also set
`core.hooksPath = .githooks` so git actually invokes the hook.

#### Scenario: Hook present after setup
- **WHEN** `bash scripts/install-agent-git-hooks.sh` runs in a repo that has
  `templates/githooks/post-checkout` installed under `.githooks/`
- **THEN** `.githooks/post-checkout` exists and is executable
- **AND** `git config --get core.hooksPath` returns `.githooks`.

### Requirement: Primary checkout cannot be silently switched during agent sessions
The `post-checkout` hook SHALL print a `[agent-primary-branch-guard]` warning
when the primary working tree (where `git-dir == git-common-dir`) is switched
AWAY from a protected branch (`main`, `dev`, `master`, or any branch listed
in `multiagent.protectedBranches`) during an agent session. Agent sessions
are detected via the presence of any of: `CLAUDECODE`,
`CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`, `OMX_SESSION_ID`, or
`CODEX_CI=1`. If the working tree is clean, the hook SHALL auto-revert the
primary checkout to the previous protected branch.

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
- **AND** the branch is NOT reverted so no uncommitted work is lost.

### Requirement: Secondary worktrees are exempt
The `post-checkout` hook SHALL exit 0 with no output when invoked inside a
secondary git worktree (where the resolved `git-dir` differs from the
resolved `git-common-dir`).

#### Scenario: Worktree branch switch is silent
- **GIVEN** a worktree created via `git worktree add`
- **WHEN** `git checkout <branch>` runs inside that worktree
- **THEN** the hook exits 0 with no output.

### Requirement: GUARDEX_ALLOW_PRIMARY_BRANCH_SWITCH bypass
The hook SHALL exit 0 with no output and no auto-revert when the environment
variable `GUARDEX_ALLOW_PRIMARY_BRANCH_SWITCH=1` is set.

#### Scenario: Bypass disables the guard
- **GIVEN** `GUARDEX_ALLOW_PRIMARY_BRANCH_SWITCH=1` is exported
- **WHEN** any primary-checkout branch switch happens
- **THEN** the hook produces no output and does not revert.

### Requirement: CLI wiring covers the hook in all four lists
`bin/multiagent-safety.js` SHALL register the hook in four lists:
`githooks/post-checkout` in `TEMPLATE_FILES`, and `.githooks/post-checkout`
in each of `EXECUTABLE_RELATIVE_PATHS`, `CRITICAL_GUARDRAIL_PATHS`, and
`MANAGED_GITIGNORE_PATHS`.

#### Scenario: CLI knows about the hook
- **WHEN** `grep -cE "'githooks/post-checkout'|'\.githooks/post-checkout'" bin/multiagent-safety.js`
  is run at the repo root
- **THEN** the count is 4 (one entry per list).
