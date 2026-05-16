## ADDED Requirements

### Requirement: Setup installs only repo-local state and dispatch shims

`gx setup` and `gx doctor` SHALL keep the managed repo footprint limited to repo-local state and dispatch shims, not copied workflow logic.

#### Scenario: setup installs the minimal repo footprint

- **GIVEN** a repo opts into Guardex
- **WHEN** `gx setup` runs
- **THEN** it installs the managed AGENTS block, `.githooks/*` dispatch shims, `scripts/*` workflow shims, `.omx/.omc` scaffold, lock registry state, and the managed `.gitignore` block
- **AND** it does not copy workflow implementations, repo-local Codex/Claude skills, or inject Guardex-managed `agent:*` helper scripts into `package.json`

#### Scenario: doctor repairs the minimal footprint without restoring copied scripts

- **GIVEN** a repo already uses the CLI-owned install surface
- **WHEN** `gx doctor` repairs drift
- **THEN** it restores the managed AGENTS block, hook/workflow shims, lock registry, and managed `.gitignore` entries as needed
- **AND** it does not recreate copied workflow implementations, repo-local skills, or Guardex-managed `agent:*` package scripts

### Requirement: Hook shims dispatch through `gx`

Installed repo hooks SHALL delegate to CLI-owned hook logic instead of embedding guard behavior inline.

#### Scenario: pre-commit hook is a shim

- **GIVEN** `gx setup` installed repo hooks
- **WHEN** `.githooks/pre-commit` is inspected or executed
- **THEN** it delegates to `gx hook run pre-commit`
- **AND** the guarded pre-commit behavior still enforces the same branch and lock rules

### Requirement: CLI-owned workflow commands remain available without copied workflow implementations

The CLI SHALL expose the guard workflow directly so consumers do not need copied repo workflow logic.

#### Scenario: branch and lock commands run from the CLI

- **GIVEN** a repo with the minimal install footprint
- **WHEN** a user runs `gx branch start`, `gx branch finish`, `gx locks claim`, or `gx worktree prune`
- **THEN** the command executes using package-owned logic
- **AND** any repo-local `scripts/agent-branch-*.sh` or `scripts/agent-file-locks.py` files remain thin dispatch shims instead of copied workflow logic

### Requirement: Migration removes old-style copied workflow files

The CLI SHALL provide a migration path from old repo-local installs to the CLI-owned surface.

#### Scenario: migrate converts an old-style install

- **GIVEN** a repo still contains Guardex-managed workflow scripts, repo-local skills, and injected `agent:*` package scripts
- **WHEN** `gx migrate` runs
- **THEN** it replaces hooks with dispatch shims
- **AND** it removes the copied workflow scripts and managed `agent:*` script injections
- **AND** it removes repo-local Guardex skill copies when matching user-level installs are present
- **AND** it leaves the AGENTS block, lock registry, and managed `.gitignore` in the new minimal form
