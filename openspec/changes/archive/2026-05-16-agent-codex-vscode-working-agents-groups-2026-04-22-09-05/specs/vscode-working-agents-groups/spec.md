## ADDED Requirements

### Requirement: Active Agents highlights sandbox session state clearly
The VS Code Active Agents companion SHALL separate Guardex sandbox sessions into explicit state groups inside the `ACTIVE AGENTS` section.

#### Scenario: Session states render in distinct groups
- **WHEN** a repo has live Guardex sessions inferred as `blocked`, `working`, `idle`, `stalled`, or `dead`
- **THEN** the repo node contains an `ACTIVE AGENTS` section
- **AND** that section renders child groups for each present state
- **AND** the groups are ordered `BLOCKED`, `WORKING NOW`, `IDLE`, `STALLED`, `DEAD`
- **AND** the `BLOCKED` group appears above `WORKING NOW`.

#### Scenario: Repo summary exposes working and dead counts
- **WHEN** a repo has one or more live `working` or `dead` sessions
- **THEN** the repo row description includes the working count in addition to the active count
- **AND** the repo row description includes the dead count when present
- **AND** the Source Control badge tooltip mentions working-now and dead counts when present.

#### Scenario: Each session state uses a distinct visual affordance
- **WHEN** a live Guardex session is inferred as `blocked`, `working`, `idle`, `stalled`, or `dead`
- **THEN** its row uses a distinct codicon for that state
- **AND** its tooltip summarizes the derived state reason
- **AND** the row still keeps the existing activity/count/elapsed description text.
