## ADDED Requirements

### Requirement: cli main module SHALL be a thin dispatcher
`src/cli/main.js` SHALL contain only the dispatch table for `gx`, the
deprecated-alias warning hop, and the no-args default flow
(cockpit + status + auto-doctor). All subcommand handler bodies SHALL live
in `src/cli/commands/<verb>.js`, and shared scaffolding/sandbox helpers
SHALL live in `src/cli/shared/`.

#### Scenario: dispatcher size budget
- **WHEN** the refactor is complete
- **THEN** `wc -l src/cli/main.js` reports fewer than 300 lines
- **AND** `src/cli/commands/` contains one module per dispatched verb (or a
  small cluster of closely-related verbs)
- **AND** `src/cli/shared/` exposes the cross-command scaffolding, sandbox,
  environment, and toolchain-shim helpers as a require()-able surface.

#### Scenario: byte-identical CLI surface
- **WHEN** `gx --help`, `gx --version`, `gx doctor --help`, and
  `gx locks --help` are invoked before and after the refactor
- **THEN** stdout, stderr, and exit codes are byte-identical.

#### Scenario: test suite is regression-free
- **WHEN** `npm test` is run on the refactored worktree
- **THEN** the failing test set is identical to the pre-refactor `main`
  baseline (no new failures introduced; pre-existing flaky/environment-
  dependent failures still flake unchanged).
