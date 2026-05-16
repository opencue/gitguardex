## ADDED Requirements

### Requirement: Setup links Claude guidance to AGENTS when absent
`gx setup` and `gx doctor` SHALL create a root `CLAUDE.md` symlink to `AGENTS.md` when the target repository has no root `CLAUDE.md`.

#### Scenario: Fresh setup creates both guidance entrypoints
- **WHEN** `gx setup --target <repo>` runs in a repo with no root `AGENTS.md` or `CLAUDE.md`
- **THEN** `AGENTS.md` contains the Guardex managed guidance block
- **AND** `CLAUDE.md` is a symlink whose target is `AGENTS.md`.

#### Scenario: Existing Claude guidance is preserved
- **GIVEN** the target repo already has a root `CLAUDE.md`
- **WHEN** `gx setup --target <repo>` runs
- **THEN** Guardex SHALL leave the existing `CLAUDE.md` content and file type unchanged.
