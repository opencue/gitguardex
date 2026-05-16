## ADDED Requirements

### Requirement: Guardex writes active session presence for sandboxed Codex runs
The system SHALL write repo-local active session presence records while `scripts/codex-agent.sh` is running an interactive sandbox session.

#### Scenario: Session start records live metadata
- **WHEN** `scripts/codex-agent.sh` launches Codex in a sandbox worktree
- **THEN** Guardex writes a JSON record under `.omx/state/active-sessions/`
- **AND** the record includes the repo root, sandbox branch, task name, agent name, worktree path, launch PID, CLI name, and start timestamp.

#### Scenario: Session exit removes presence record
- **WHEN** the wrapper exits after Codex finishes
- **THEN** the corresponding `.omx/state/active-sessions/` record is removed
- **AND** later launches for the same branch can recreate it cleanly.

### Requirement: VS Code companion shows active Guardex lanes in Source Control
The system SHALL provide a VS Code companion extension that surfaces live Guardex sessions in the Source Control container.

#### Scenario: Live sessions render with native spinner
- **WHEN** the companion finds live session records for the current workspace
- **THEN** it shows an `Active Agents` view in the Source Control container
- **AND** each live session renders with a native animated VS Code icon equivalent to `loading~spin`
- **AND** the row includes the branch identity plus an elapsed-time description.

#### Scenario: Dead or stale sessions are ignored
- **WHEN** a session record references a PID that is no longer running or contains invalid JSON
- **THEN** the companion does not render it as an active agent row
- **AND** valid rows continue to render.

### Requirement: Local install path enables the companion without Marketplace publishing
The system SHALL provide a local install path for the companion extension from the repo checkout.

#### Scenario: Local install copies the extension to the VS Code extensions directory
- **WHEN** the local install helper is run
- **THEN** it copies the companion extension into the target VS Code extensions directory using the extension package version
- **AND** it replaces older local installs for the same extension identifier so reload picks up the newest sources.
