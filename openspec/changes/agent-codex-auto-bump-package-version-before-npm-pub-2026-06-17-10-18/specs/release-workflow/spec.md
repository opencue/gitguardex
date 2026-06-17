## ADDED Requirements

### Requirement: Direct npm publish auto-bumps already-published versions
Direct maintainer `npm publish` SHALL check whether the current package version is already present on npm and SHALL bump package release metadata to the next unpublished patch version before publish continues.

#### Scenario: already-published direct publish version
- **GIVEN** a maintainer runs `npm publish` from the Guardex package checkout
- **AND** the current `package.json` version already exists on npm
- **WHEN** the prepublish lifecycle runs
- **THEN** `package.json` SHALL be updated to the next unpublished patch version
- **AND** `package-lock.json` root package metadata SHALL be updated to the same version
- **AND** README release notes SHALL include the bumped version
- **AND** publish SHALL continue with the bumped package metadata.

#### Scenario: direct publish version is not published yet
- **GIVEN** a maintainer runs `npm publish` from the Guardex package checkout
- **AND** the current `package.json` version does not exist on npm
- **WHEN** the prepublish lifecycle runs
- **THEN** package release metadata SHALL remain unchanged.

#### Scenario: CI release publish keeps committed metadata
- **GIVEN** the GitHub Actions release workflow runs `npm publish`
- **WHEN** the prepublish lifecycle runs
- **THEN** the automatic bump SHALL be skipped by default so packed and signed release assets stay aligned with committed package metadata.
