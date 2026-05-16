## ADDED Requirements

### Requirement: Published Skill Catalog
The npm package manifest SHALL include the repo-root `skills/` catalog so skill installers can access the GitGuardex skill from the published package.

#### Scenario: Package tarball includes repo skills
- **WHEN** the package is packed for publication
- **THEN** `skills/gitguardex/SKILL.md` is included
- **AND** `skills/guardex-merge-skills-to-dev/SKILL.md` is included.

### Requirement: Skill Install Documentation
The README SHALL document the `npx skills add recodee/gitguardex` repo skill install path and explain that the npm package ships the root `skills/` catalog.

#### Scenario: User finds npx skill install path
- **WHEN** a user reads the companion tools section
- **THEN** the `npx skills add recodee/gitguardex` install command is visible
- **AND** the package-backed skill catalog behavior is described.
