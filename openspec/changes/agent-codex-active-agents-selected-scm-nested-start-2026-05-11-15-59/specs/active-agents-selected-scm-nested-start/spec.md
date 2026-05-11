## ADDED Requirements

### Requirement: Start Agent targets the selected workspace repository
The Active Agents VS Code extension SHALL start new agents in the selected workspace Git repository rather than assuming the outer workspace root.

#### Scenario: Active editor belongs to a nested Git repository
- **GIVEN** a workspace contains an outer folder and nested Git repositories
- **AND** the active editor is inside one nested Git repository
- **WHEN** the user runs `gitguardex.activeAgents.startAgent`
- **THEN** the extension launches the terminal in that nested repository
- **AND** the command uses `gx agents start --target <nested-repo>`
- **AND** no repository picker is shown.

#### Scenario: Multiple repositories remain ambiguous
- **GIVEN** a workspace contains multiple Git repositories
- **AND** no active SCM/editor repository can be inferred
- **WHEN** the user runs `gitguardex.activeAgents.startAgent`
- **THEN** the extension shows a repository picker
- **AND** each pick shows the repository path plus branch and dirty-state cues
- **AND** the selected repository is passed to `gx agents start --target <selected-repo>`.
