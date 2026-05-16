## MODIFIED Requirements

### Requirement: Active Agents extension installs a visible current plugin version

The Active Agents VS Code companion SHALL expose a higher extension version whenever shipped plugin files change on a branch, and the live/template manifests SHALL stay aligned.

#### Scenario: Plugin edits require a version bump

- **GIVEN** a branch changes any shipped Active Agents extension files under `vscode/guardex-active-agents/**`, `templates/vscode/guardex-active-agents/**`, or `scripts/install-vscode-active-agents-extension.js`
- **WHEN** the focused extension regression suite runs
- **THEN** `vscode/guardex-active-agents/package.json` SHALL declare a version greater than the base branch version
- **AND** `templates/vscode/guardex-active-agents/package.json` SHALL match that same version exactly

### Requirement: Active Agents extension activates on VS Code startup

The Active Agents VS Code companion SHALL declare startup activation in both shipped manifests so the companion can initialize immediately after the VS Code window reloads.

#### Scenario: Startup activation stays in sync across shipped manifests

- **GIVEN** the live and template Active Agents extension manifests ship in the repo
- **WHEN** the extension install regression suite reads those manifests
- **THEN** both manifests SHALL include `onStartupFinished`
- **AND** the installed extension manifest SHALL preserve that same activation event list

### Requirement: Active Agents extension installs a newer workspace build and prompts reload

The Active Agents VS Code companion SHALL install a newer workspace-shipped build of itself when one is available and SHALL offer a reload action so the updated companion takes effect immediately.

#### Scenario: Running companion sees a newer workspace build

- **GIVEN** the running Active Agents extension version is older than `vscode/guardex-active-agents/package.json` in the open workspace
- **AND** the workspace contains `scripts/install-vscode-active-agents-extension.js`
- **WHEN** the companion activates
- **THEN** it SHALL run that install script with the workspace root as the current working directory
- **AND** it SHALL show a message offering `Reload Window`
