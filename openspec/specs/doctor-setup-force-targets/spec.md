# doctor-setup-force-targets Specification

## Purpose
TBD - created by archiving change agent-codex-fix-doctor-setup-force-conflict-ux-2026-04-22-08-58. Update Purpose after archive.
## Requirements
### Requirement: setup and doctor accept targeted managed-file force paths

`gx setup` and `gx doctor` SHALL accept one or more managed relative paths after `--force` so users can repair only the named managed files instead of rewriting the entire managed surface.

#### Scenario: doctor rewrites one named managed shim

- **GIVEN** a repo has a conflicting managed `scripts/review-bot-watch.sh`
- **WHEN** the user runs `gx doctor --force scripts/review-bot-watch.sh`
- **THEN** the command succeeds
- **AND** `scripts/review-bot-watch.sh` is rewritten to the current managed shim
- **AND** the path selector is not treated as an unknown option

#### Scenario: setup rewrites one named managed template

- **GIVEN** a repo has a conflicting managed `.github/workflows/ci.yml`
- **WHEN** the user runs `gx setup --force .github/workflows/ci.yml`
- **THEN** the command succeeds
- **AND** `.github/workflows/ci.yml` is rewritten to the current managed template

### Requirement: conflict output teaches targeted and global force recovery

When a managed file conflict blocks `gx setup` or `gx doctor`, the CLI SHALL tell the user how to recover with either a targeted `--force <managed-path>` or a full-surface `--force`.

#### Scenario: conflict message names both force paths

- **GIVEN** a managed file differs from the current Guardex output
- **WHEN** `gx setup` or `gx doctor` hits that conflict without `--force`
- **THEN** the error names the conflicting managed path
- **AND** the error teaches `--force <managed-path>` for one-file recovery
- **AND** the error teaches plain `--force` for rewriting all managed files

