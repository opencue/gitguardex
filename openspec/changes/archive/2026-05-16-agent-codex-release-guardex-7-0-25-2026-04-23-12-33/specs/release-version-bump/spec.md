## ADDED Requirements

### Requirement: Release metadata and bundled companion version alignment

The release metadata SHALL move to the next publishable Guardex package version when maintainers intentionally request the next npm release after the current published Guardex version, and any bundled Active Agents companion version exposed by that release SHALL be recorded alongside it.

#### Scenario: Prepare the next publishable npm patch release with companion-visible notes

- **GIVEN** the current Guardex package version is already the latest published release metadata in the repo and npm registry
- **AND** the shipped repo contains newer Active Agents companion changes that operators should see called out in the next release
- **WHEN** maintainers request the next npm version bump
- **THEN** `package.json` and `package-lock.json` SHALL be bumped to the next publishable semver
- **AND** `README.md` SHALL record the new release version with the shipped Active Agents companion improvements
- **AND** the live/template Active Agents manifests SHALL expose the companion version bundled by that release.
