## ADDED Requirements

### Requirement: Release recovery version alignment
The release metadata SHALL move to the next publishable package version when maintainers intentionally request the next npm release after the current published Guardex version.

#### Scenario: Prepare the next publishable npm patch release
- **GIVEN** the current Guardex package version is already the latest published release metadata in the repo and npm registry
- **WHEN** maintainers request the next npm version bump
- **THEN** `package.json` and `package-lock.json` SHALL be bumped to the next publishable semver
- **AND** `README.md` SHALL record the new release version with the newly shipped behavior that the package now contains.
