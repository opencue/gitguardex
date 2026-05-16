## ADDED Requirements

### Requirement: cockpit opens a repo tmux session

Guardex SHALL provide a `gx cockpit` command that creates or attaches to a tmux session for the resolved repo root.

#### Scenario: missing default session

- **GIVEN** tmux is installed
- **AND** the default `guardex` session does not exist
- **WHEN** the user runs `gx cockpit`
- **THEN** Guardex SHALL create the `guardex` tmux session with its working directory set to the repo root
- **AND** the initial pane SHALL run `gx agents status`
- **AND** Guardex SHALL NOT launch agents or install cockpit keyboard shortcuts.

#### Scenario: named missing session with attach requested

- **GIVEN** tmux is installed
- **AND** the requested session does not exist
- **WHEN** the user runs `gx cockpit --session guardex --attach`
- **THEN** Guardex SHALL create the requested tmux session in the repo root
- **AND** Guardex SHALL attach to it after creation.

#### Scenario: existing session

- **GIVEN** tmux is installed
- **AND** the requested tmux session exists
- **WHEN** the user runs `gx cockpit`
- **THEN** Guardex SHALL attach to the existing session
- **AND** Guardex SHALL NOT create a duplicate session.

#### Scenario: tmux unavailable

- **GIVEN** tmux is not available on PATH
- **WHEN** the user runs `gx cockpit`
- **THEN** Guardex SHALL print a helpful error telling the user tmux is required.
