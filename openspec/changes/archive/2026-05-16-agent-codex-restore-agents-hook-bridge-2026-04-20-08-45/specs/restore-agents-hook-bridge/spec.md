## ADDED Requirements

### Requirement: restore-agents-hook-bridge behavior
The repository SHALL provide a valid `.agents/hooks/*` resolution path for local hook execution.

#### Scenario: Hook path compatibility is present
- **WHEN** a local hook command invokes `python3 <repo>/.agents/hooks/skill_activation.py`
- **THEN** the file path SHALL resolve without `ENOENT`
- **AND** the hook process SHALL exit successfully for empty stdin.

#### Scenario: Existing guard hook remains callable through `.agents`
- **WHEN** a local hook command invokes `python3 <repo>/.agents/hooks/skill_guard.py`
- **THEN** the file path SHALL resolve without `ENOENT`
- **AND** the hook process SHALL exit successfully for empty stdin.
