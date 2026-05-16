## ADDED Requirements

### Requirement: recursive doctor repairs nested repos
The system SHALL repair nested standalone git repos during `gx doctor` so local Guardex enforcement is restored across the whole target tree, not only the top-level repo.

#### Scenario: parent doctor repairs a nested frontend repo on protected main
- **GIVEN** a parent repo contains a nested standalone frontend repo on protected `main`
- **AND** the nested repo is missing Guardex-managed files such as `AGENTS.md`, `scripts/agent-branch-start.sh`, or `.githooks/pre-commit`
- **WHEN** `gx doctor --target <parent-repo>` runs
- **THEN** the doctor flow SHALL recurse into the nested repo
- **AND** protected-branch sandbox repair SHALL sync the repaired managed Guardex files back to the nested repo primary workspace
- **AND** `gx scan --target <nested-repo>` SHALL report no safety issues after the repair completes.
