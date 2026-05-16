## ADDED Requirements

### Requirement: Active Agents SCM view exposes header state
The Guardex Active Agents VS Code companion SHALL create the `gitguardex.activeAgents` SCM view through a tree-view handle so the view can expose header state in addition to item rows.

#### Scenario: Live sessions set a header badge
- **WHEN** one or more live Guardex sessions are available in the current workspace
- **THEN** the SCM view shows the session rows
- **AND** the view header badge reflects the live session count.

#### Scenario: Empty state sets a view message
- **WHEN** no live Guardex sessions are available in the current workspace
- **THEN** the SCM view remains available in Source Control
- **AND** the view exposes an empty-state message that tells the operator to start a sandbox session.

### Requirement: Active Agents SCM view is visible by default
The `gitguardex.activeAgents` SCM contribution SHALL default to visible so operators do not need to discover it manually in the SCM views menu on first install.

#### Scenario: First load shows the section
- **WHEN** the extension is installed in a workspace with Source Control open
- **THEN** the Active Agents section is available in the SCM container without requiring a manual enable step.
