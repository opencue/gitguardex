## ADDED Requirements

### Requirement: Any non-protected branch is agent-managed by default
The branch guards SHALL treat any branch that is not a protected base as an
agent-managed branch on which agents may edit files and create commits, without
requiring a specific namespace prefix. Protected bases are `main`, `dev`,
`master`, plus any branch configured via `GUARDEX_PROTECTED_BRANCHES` or
`multiagent.protectedBranches`.

#### Scenario: Edit and commit on an ad-hoc branch
- **WHEN** an agent session is on a non-protected branch such as `vendor/acme`, `feat/x`, or a bare name
- **THEN** `skill_guard.py` allows file edits and shell commands on that branch
- **AND** the git pre-commit hook allows the commit
- **AND** the agent is not told to switch to an `agent/*` branch.

#### Scenario: Protected base stays blocked
- **WHEN** an agent session attempts to edit or commit on a protected base (`main`/`dev`/`master`, or a configured protected branch)
- **THEN** both guards block the action with a protected-branch message.

#### Scenario: Codex managed-only commit on protected base is preserved
- **WHEN** a Codex session commits only `AGENTS.md` and/or `.gitignore` on a protected base
- **THEN** the git pre-commit hook allows that commit, unchanged from prior behavior.

### Requirement: Lockdown re-imposes the agent/* namespace
The guards SHALL provide opt-in lockdown switches that restore the stricter
namespace requirement.

#### Scenario: skill_guard prefix lockdown
- **WHEN** `GUARDEX_AGENT_BRANCH_PREFIXES_ONLY=1` is set
- **THEN** `skill_guard.py` treats only branches matching the configured prefix allowlist as agent-managed and blocks all others.

#### Scenario: git commit lockdown
- **WHEN** `GUARDEX_REQUIRE_AGENT_BRANCH=1` or `git config multiagent.requireAgentBranch true` is set
- **THEN** the git pre-commit hook blocks agent commits on any branch outside the `agent/*` namespace with a lockdown message.
