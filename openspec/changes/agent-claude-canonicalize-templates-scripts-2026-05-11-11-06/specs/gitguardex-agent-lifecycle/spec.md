# Spec Delta: gitguardex-agent-lifecycle

## ADDED Requirements

### Requirement: Paired scripts under `scripts/` and `templates/scripts/` MUST be symlinked

For every script tracked under both `scripts/` and `templates/scripts/` that the gx CLI also bundles into consumer repos as a legacy workflow shim, the `scripts/` copy MUST be a symlink to the matching `templates/scripts/` file. `templates/scripts/` is the single source of truth and the path the runtime CLI invokes (see `src/context.js` `PACKAGE_SCRIPT_ASSETS`). Files intentionally tracked only on one side (e.g. `scripts/guardex-env.sh`, gitignored) are excluded.

#### Scenario: Direct invocation works through the symlink

- **GIVEN** the gitguardex repo is checked out with the symlinks in place
- **WHEN** a contributor runs `bash scripts/agent-branch-start.sh --no-transfer ...`
- **THEN** the shell follows the symlink to `templates/scripts/agent-branch-start.sh`
- **AND** the runtime-canonical script's argument parser handles the flag

#### Scenario: Python invocation works through the symlink

- **GIVEN** the symlink at `scripts/agent-file-locks.py`
- **WHEN** the gx CLI runs `python3 scripts/agent-file-locks.py status`
- **THEN** Python resolves the symlink and executes the canonical implementation under `templates/scripts/`

#### Scenario: `npm run agent:branch:start` still works

- **GIVEN** `package.json` defines `"agent:branch:start": "bash ./scripts/agent-branch-start.sh"` and the file is a symlink
- **WHEN** the contributor runs `npm run agent:branch:start`
- **THEN** the command succeeds with the same behavior as before the canonicalization

### Requirement: CI MUST fail when a required `scripts/` symlink is replaced with a regular file

The `.github/workflows/ci.yml` test job MUST run `bash scripts/check-script-symlinks.sh` as a step, and the step MUST exit non-zero if any required symlink is missing, points to the wrong target, or has been replaced with a regular file. The error output MUST include the exact `rm + ln -s` recipe to restore the invariant.

#### Scenario: A PR replaces a symlink with a regular file

- **GIVEN** a PR commits `scripts/agent-branch-start.sh` as a regular file (instead of a symlink)
- **WHEN** the CI workflow runs
- **THEN** the `check-script-symlinks.sh` step exits non-zero
- **AND** the output names the offending path and prints `rm scripts/agent-branch-start.sh && ln -s ../templates/scripts/agent-branch-start.sh scripts/agent-branch-start.sh`

#### Scenario: All paired scripts are correctly symlinked

- **GIVEN** every entry in the required-symlink list points to its `../templates/scripts/<basename>` counterpart
- **WHEN** `bash scripts/check-script-symlinks.sh` runs
- **THEN** the script prints `OK: N paired script(s) verified.` and exits 0
