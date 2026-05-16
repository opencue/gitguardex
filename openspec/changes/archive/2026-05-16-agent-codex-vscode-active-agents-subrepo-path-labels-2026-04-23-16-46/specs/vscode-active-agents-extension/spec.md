## ADDED Requirements

### Requirement: Active Agents exposes a restart action from extension management surfaces
The VS Code `recodeee.gitguardex-active-agents` extension MUST expose a `Restart Active Agents` action anywhere VS Code allows contributed extension-management commands, so operators can restart the extension host without reloading the full window.

#### Scenario: Restart command appears on the extension details gear menu
- **GIVEN** GitGuardex Active Agents is installed
- **WHEN** the operator opens the extension details page or extension context menu
- **THEN** the extension contributes a `Restart Active Agents` action for `recodeee.gitguardex-active-agents`
- **AND** the action does not appear for unrelated extensions.

#### Scenario: Restart command restarts the extension host
- **GIVEN** the operator invokes `Restart Active Agents`
- **WHEN** the command runs
- **THEN** it executes `workbench.action.restartExtensionHost`
- **AND** it does not require `workbench.action.reloadWindow`.

### Requirement: Active Agents exposes restart from its own sidebar
The VS Code `gitguardex.activeAgents` view MUST expose the same `Restart Active Agents` action from the view title so operators can restart the extension without leaving the sidebar.

#### Scenario: Restart command appears in the Active Agents view title
- **GIVEN** the Active Agents view is visible
- **WHEN** the view title actions render
- **THEN** `Restart Active Agents` is available alongside the other view-level actions.
