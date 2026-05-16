## ADDED Requirements

### Requirement: Finish pushes changed submodule branches before parent branch publication
When an agent branch updates a submodule gitlink, `gx branch finish` SHALL push the checked-out submodule branch that contains the gitlink commit before pushing or merging the parent repository branch.

#### Scenario: Changed submodule branch is local-only
- **GIVEN** a parent agent branch points a submodule gitlink at a commit that exists only on a local submodule branch
- **WHEN** `gx branch finish` runs with push enabled
- **THEN** the submodule branch is pushed to the submodule remote before the parent branch is pushed or merged
- **AND** the parent finish flow continues only after that submodule push succeeds.

#### Scenario: Changed submodule commit cannot be safely published
- **GIVEN** a parent agent branch points a submodule gitlink at a commit without a checked-out submodule branch that contains it
- **WHEN** `gx branch finish` runs with push enabled
- **THEN** Guardex reports the unsafe submodule state
- **AND** the parent branch is not pushed by the finish flow.
