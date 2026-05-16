## ADDED Requirements

### Requirement: Active Agents SCM tree keeps repo context
The Guardex Active Agents VS Code companion SHALL render live sessions under a repo-scoped tree layout so operators can see active lanes in the same SCM-side structure as nearby repo changes.

#### Scenario: Live repo renders grouped sections
- **WHEN** the companion finds one or more live Guardex sessions for a repo in the current workspace
- **THEN** the SCM tree shows a repo node for that repo
- **AND** the repo node contains an `ACTIVE AGENTS` section with the live session rows
- **AND** each session row keeps its activity state plus elapsed-time description.

#### Scenario: Repo changes render beside active agents
- **WHEN** a repo with live Guardex sessions also has local git modifications in its root working tree
- **THEN** the repo node also contains a `CHANGES` section
- **AND** the change rows reflect the repo-relative changed paths
- **AND** the change rows surface concise git status markers.

#### Scenario: Change inspection failure degrades safely
- **WHEN** the companion cannot inspect repo git status for a repo that still has live Guardex sessions
- **THEN** the `ACTIVE AGENTS` section still renders
- **AND** the repo simply omits `CHANGES` rows instead of crashing or hiding the repo node.
