## ADDED Requirements

### Requirement: agent-branch-upstream-tracking behavior
The system SHALL keep freshly created `agent/*` worktree branches unpublished until the branch is explicitly pushed, while still remembering which protected base branch they were started from.

#### Scenario: Branch start from a protected base branch
- **GIVEN** `scripts/agent-branch-start.sh` creates a new `agent/*` branch from `origin/main`, `origin/dev`, or another protected base branch
- **WHEN** the new sandbox worktree is ready
- **THEN** the new `agent/*` branch has no git upstream configured
- **AND** `branch.<agent-branch>.guardexBase` still stores the protected base branch name
- **AND** future publish steps can establish the upstream branch explicitly with `git push -u`.

#### Scenario: Codex fallback sandbox start
- **GIVEN** `scripts/codex-agent.sh` falls back to its internal safe worktree starter
- **WHEN** it creates a new `agent/*` branch from a protected base branch
- **THEN** the fallback-created branch has no git upstream configured
- **AND** the fallback path still stores `branch.<agent-branch>.guardexBase`.
