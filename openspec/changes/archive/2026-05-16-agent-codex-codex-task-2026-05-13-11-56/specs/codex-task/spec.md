## ADDED Requirements

### Requirement: Fleet cockpit scan view
The system SHALL render cockpit sessions as a compact fleet board that is easy to scan by agent state.

#### Scenario: Active sessions are grouped by operator state
- **WHEN** the cockpit renderer receives sessions with working, thinking, blocked, done, and stale states
- **THEN** it SHALL include a summary count for each state
- **AND** it SHALL render non-empty state groups with clear headings.

#### Scenario: Session rows preserve follow-up evidence
- **WHEN** a session is rendered in the fleet board
- **THEN** its row SHALL include branch, progress, worktree, lock, changed-file, task, Colony metadata, PR, and heartbeat details when available
- **AND** existing cockpit text output consumers SHALL still receive a plain terminal string.
