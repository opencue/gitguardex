## ADDED Requirements

### Requirement: Canonical Active Agents source
The system SHALL treat `vscode/guardex-active-agents/` as the single editable
source of truth for the Active Agents VS Code companion bundle.

#### Scenario: Editing the extension bundle
- **WHEN** maintainers change the Active Agents extension implementation
- **THEN** the authoritative edits happen under
  `vscode/guardex-active-agents/`
- **AND** the workflow does not require manual mirror edits under
  `templates/vscode/guardex-active-agents/`.

### Requirement: Derived template bundle parity
The system SHALL provide an explicit repo-managed path that refreshes
`templates/vscode/guardex-active-agents/` from the canonical source and guards
parity for the full shipped bundle.

#### Scenario: Refreshing the managed template bundle
- **WHEN** the canonical Active Agents source changes
- **THEN** the managed template bundle is refreshed from that canonical source
- **AND** parity protection covers `package.json`, `README.md`, `icon.png`,
  `extension.js`, and `session-schema.js`.

### Requirement: Existing install and session-state consumers stay stable
The system SHALL preserve the current local install and session-state behavior
while the template bundle becomes derived.

#### Scenario: Installing the extension locally
- **WHEN** `node scripts/install-vscode-active-agents-extension.js` runs
- **THEN** it installs the canonical Active Agents bundle
- **AND** operators do not need template-only edits for local VS Code installs.

#### Scenario: Resolving session state helpers
- **WHEN** `node scripts/agent-session-state.js` loads the session schema module
- **THEN** it resolves the canonical runtime bundle first
- **AND** any retained template fallback stays behaviorally equivalent to the
  canonical source.
