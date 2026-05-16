## ADDED Requirements

### Requirement: finish flow chooses a real base branch
Guardex SHALL finish agent branches against an available base branch even when no explicit base metadata is stored on the source branch.

#### Scenario: main-only repo without stored base metadata
- **GIVEN** an agent branch is being finished
- **AND** the branch does not have `branch.<name>.guardexBase` metadata
- **AND** the repo exposes `main` but not `dev`
- **WHEN** `scripts/agent-branch-finish.sh` resolves the base branch
- **THEN** it SHALL select `main`
- **AND** it SHALL not fall through to a non-existent `dev` base.

### Requirement: explicit agent roles stay visible in sandbox names
Guardex SHALL preserve explicit agent role tokens in branch/worktree naming while keeping legacy compatibility aliases for the common `codex`, `claude`, and `bot` flows.

#### Scenario: explicit planner role requested
- **GIVEN** `scripts/agent-branch-start.sh` is invoked with an explicit role such as `planner`
- **WHEN** the branch name is normalized
- **THEN** the emitted branch/worktree name SHALL keep the explicit sanitized role token
- **AND** legacy `bot` inputs SHALL still collapse to `codex`.

### Requirement: codex-agent auto-finish requires mergeable remote context
Guardex SHALL skip the PR auto-finish path when the current repo does not expose a mergeable GitHub-backed remote context.

#### Scenario: local or file-backed origin remote
- **GIVEN** `scripts/codex-agent.sh` finishes a successful task run
- **AND** the repo `origin` resolves to a local path or `file://` URL, or `gh` auth is not usable
- **WHEN** auto-finish evaluation runs
- **THEN** Guardex SHALL skip the PR merge/wait flow
- **AND** it SHALL keep the sandbox branch/worktree available for manual follow-up instead of waiting for merge.
