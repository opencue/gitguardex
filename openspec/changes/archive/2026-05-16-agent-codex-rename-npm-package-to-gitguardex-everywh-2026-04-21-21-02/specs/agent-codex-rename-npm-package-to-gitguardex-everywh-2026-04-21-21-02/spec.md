## ADDED Requirements

### Requirement: Published npm package name matches GitGuardex
The system SHALL publish and document the primary npm package as `@imdeadpool/gitguardex`.

#### Scenario: package metadata advertises the renamed package
- **WHEN** the root `package.json` metadata is inspected
- **THEN** `name` equals `@imdeadpool/gitguardex`
- **AND** downstream package metadata snapshots use the same package name.

#### Scenario: install and update prompts use the renamed package
- **WHEN** a user reads CLI install/setup guidance or the self-update flow
- **THEN** the npm command examples reference `@imdeadpool/gitguardex`
- **AND** the CLI keeps `gx` plus the legacy `guardex` bin alias available for compatibility.

### Requirement: User-facing docs stay aligned with the renamed package
The README and user-visible tutorial/docs assets SHALL present GitGuardex with the renamed npm package.

#### Scenario: README and tutorial install guidance is aligned
- **WHEN** the README, tutorial page, or README-linked SVG assets are inspected
- **THEN** install commands, npm badges, and package-name callouts reference `@imdeadpool/gitguardex`
- **AND** the wording presents GitGuardex as the primary brand.
