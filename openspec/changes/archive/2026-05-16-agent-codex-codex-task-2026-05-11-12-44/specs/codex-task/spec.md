## ADDED Requirements

### Requirement: Guardex Codex sessions default to no approval prompts
Guardex Codex launcher sessions SHALL pass an approval policy of `never` to Codex unless the caller supplied an approval policy explicitly or disabled the default.

#### Scenario: Default launcher invocation
- **WHEN** `scripts/codex-agent.sh` launches Codex without an approval policy argument
- **THEN** Codex is invoked with `-a never`.

#### Scenario: Explicit caller override
- **WHEN** `scripts/codex-agent.sh` receives an approval policy argument from the caller
- **THEN** the launcher SHALL NOT add a second default `-a never` argument.

#### Scenario: Conflict review relaunch
- **WHEN** the launcher starts a Codex conflict-review pass
- **THEN** the same default approval policy handling applies.
