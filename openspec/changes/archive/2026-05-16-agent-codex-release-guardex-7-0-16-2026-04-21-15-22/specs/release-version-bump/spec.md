## ADDED Requirements

### Requirement: Release recovery version alignment
The release metadata SHALL move to the next publishable package version when npm rejects the current version as already published.

#### Scenario: Recover from an already-published npm version
- **GIVEN** `npm publish` rejects the current Guardex version as already published
- **WHEN** maintainers prepare the recovery release
- **THEN** `package.json` and `package-lock.json` SHALL be bumped to the next publishable semver
- **AND** `README.md` SHALL record the new release version with the newly shipped behavior that the package now contains.
