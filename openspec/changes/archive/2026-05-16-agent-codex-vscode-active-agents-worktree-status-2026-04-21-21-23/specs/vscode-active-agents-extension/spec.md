## ADDED Requirements

### Requirement: Active Agents rows reflect live sandbox worktree activity
The system SHALL describe whether each live Guardex sandbox is still thinking or is actively working inside its worktree.

#### Scenario: Clean worktree stays thinking
- **WHEN** a live session points at a clean sandbox worktree
- **THEN** the Active Agents row description begins with `thinking`
- **AND** it still includes the elapsed time for that live lane.

#### Scenario: Dirty worktree surfaces working state
- **WHEN** a live session points at a sandbox worktree with tracked or untracked file changes
- **THEN** the Active Agents row description begins with `working`
- **AND** it includes the changed-file count before the elapsed time
- **AND** the row tooltip includes a preview of the changed paths.

#### Scenario: Activity inference falls back safely
- **WHEN** the companion cannot inspect the worktree git state for an otherwise live session
- **THEN** the row still renders as an active agent
- **AND** the description falls back to `thinking` instead of crashing or disappearing.
