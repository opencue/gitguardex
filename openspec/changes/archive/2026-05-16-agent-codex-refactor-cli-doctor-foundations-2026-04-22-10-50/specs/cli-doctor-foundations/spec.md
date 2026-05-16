## ADDED Requirements

### Requirement: Typed protected-main doctor sandbox lifecycle
The system SHALL keep the protected-main `gx doctor` sandbox path behaviorally equivalent while expressing its internal payloads and phase results through explicit typed contracts.

#### Scenario: Protected-main doctor still auto-finishes through the sandbox path
- **GIVEN** `gx doctor` runs on a protected local base branch
- **WHEN** the protected-main doctor flow creates a sandbox, runs nested doctor, auto-commits repairs, and finishes through the PR path
- **THEN** the observable output and success/failure behavior remain unchanged
- **AND** the existing protected-main doctor regression tests still pass.

### Requirement: Auto-finish summary classification uses explicit contracts
The system SHALL classify doctor auto-finish summary status from a well-defined summary/detail payload contract instead of relying on ambiguous loose-object access.

#### Scenario: Disabled or empty auto-finish summaries still classify from details
- **GIVEN** auto-finish reporting is disabled or does not expose completion counters
- **WHEN** the doctor renderer inspects the summary payload
- **THEN** it derives status from the first detail entry without throwing on missing fields
- **AND** compact failure/success reporting remains unchanged.
