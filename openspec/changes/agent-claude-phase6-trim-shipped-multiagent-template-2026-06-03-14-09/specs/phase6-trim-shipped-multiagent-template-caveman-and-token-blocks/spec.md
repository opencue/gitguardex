## ADDED Requirements

### Requirement: Lean shipped multi-agent contract
The installed `multiagent-safety` marker block SHALL carry the load-bearing coordination rules (isolation, ownership/locks, completion, token/context budget) and SHALL NOT duplicate generic style guidance that agents already receive from their own persona.

#### Scenario: Caveman style is not shipped
- **WHEN** `gx setup` installs or refreshes the managed `AGENTS.md` block
- **THEN** the block does not contain a `### Caveman style` subsection

#### Scenario: Token/context budget is retained
- **WHEN** the managed block is installed or refreshed
- **THEN** it still contains the `### Token / context budget` subsection (referenced by `.agent/TOKEN-DISCIPLINE.md`)
