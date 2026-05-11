# Spec Delta: gitguardex-agent-lifecycle

## ADDED Requirements

### Requirement: PR #546 lifecycle flags MUST land in the runtime-invoked template scripts

The gx CLI invokes `templates/scripts/agent-branch-start.sh` and `templates/scripts/agent-branch-finish.sh` at runtime (see `src/context.js`). All flags, env vars, and behavior introduced by PR #546 (`--no-transfer`, `--transfer`, `--transfer-exclude`, `GUARDEX_AUTO_TRANSFER*`, `--auto-resolve[=none|safe]`, `--no-auto-resolve`, `GUARDEX_FINISH_AUTO_RESOLVE*`, `path_matches_auto_resolve_safe_glob`, and the conflict-walk + `gx locks claim` + single-merge-commit flow) MUST be present in the `templates/scripts/` copies. The script copies in `scripts/` are kept in sync as a development convenience but the `templates/` copies are the source of truth at runtime.

#### Scenario: Runtime invocation through gx honors the `--no-transfer` flag

- **GIVEN** `gx branch start --no-transfer "<task>" "<agent>"` is invoked
- **WHEN** the CLI dispatches to `templates/scripts/agent-branch-start.sh`
- **THEN** the script accepts the flag (does not exit with `Unknown option: --no-transfer`)
- **AND** no auto-transfer stash is created regardless of dirty state on the protected branch

#### Scenario: Runtime invocation through gx honors the auto-transfer exclude list

- **GIVEN** `gx branch start` is invoked from a repo containing the latest gitguardex tree
- **AND** the user is on the protected base branch with an untracked file under `.omc/`
- **WHEN** the CLI dispatches to its bundled `templates/scripts/agent-branch-start.sh`
- **THEN** the `.omc/...` file remains on the protected branch and does not appear in the new agent worktree

#### Scenario: `--auto-resolve=safe` is accepted by the bundled template script

- **GIVEN** the runtime path `templates/scripts/agent-branch-finish.sh` is invoked with `--auto-resolve=safe`
- **THEN** the flag parses without `Unknown argument`
- **AND** the state-file allowlist + `gx locks claim` + single-merge-commit flow execute as in PR #546

### Requirement: `gx branch finish` MUST accept `--auto-resolve=full` and resolve fast-forward-able submodule pointer conflicts

When `--auto-resolve=full` is set, `gx branch finish` MUST handle conflicts on registered submodule paths in addition to the state-file allowlist. For each submodule pointer conflict, the script MUST determine the merge direction by checking ancestry of the three index stages against a working clone of the submodule, picking the strict descendant when one exists. The script MUST refuse and abort when the submodule histories are divergent, when the submodule URL is missing, or when no clone is reachable.

#### Scenario: Submodule pointer conflict, one side is strict ancestor of the other

- **GIVEN** the agent branch and `origin/<base>` disagree on a registered submodule's gitlink
- **AND** the submodule's `.git/modules/<path>` cached clone contains both SHAs
- **AND** the agent-branch SHA is a strict ancestor of the base-branch SHA (or vice versa)
- **WHEN** `gx branch finish --branch <branch> --auto-resolve=full ...` runs
- **THEN** the resolver writes the descendant SHA via `git update-index --cacheinfo 160000,<sha>,<path>`
- **AND** claims the resolved submodule path via `gx locks claim`
- **AND** completes the merge with one commit
- **AND** the finish flow proceeds into the normal push/PR phase

#### Scenario: Submodule pointer conflict, divergent histories

- **GIVEN** the agent branch and `origin/<base>` disagree on a submodule's gitlink
- **AND** neither SHA is an ancestor of the other in any reachable clone
- **WHEN** `gx branch finish --branch <branch> --auto-resolve=full ...` runs
- **THEN** the resolver returns non-zero for that path
- **AND** the script aborts the merge and exits non-zero
- **AND** the unresolved submodule path is listed in the abort message

#### Scenario: Submodule conflict, no clone available locally

- **GIVEN** a submodule pointer conflict on a path with no checked-out worktree and no `.git/modules/<path>` cache
- **AND** `.gitmodules` records a usable URL for the submodule
- **WHEN** `gx branch finish --branch <branch> --auto-resolve=full ...` runs
- **THEN** the resolver creates a temporary bare clone via `git clone --bare <url>`
- **AND** uses it to determine ancestry
- **AND** removes the temp clone before returning

#### Scenario: `--auto-resolve=safe` refuses submodule conflicts

- **GIVEN** a submodule pointer conflict on a registered submodule path
- **WHEN** `gx branch finish --branch <branch> --auto-resolve=safe ...` runs
- **THEN** the submodule conflict is classified as unresolved
- **AND** the abort message includes the hint "Submodule pointer auto-resolve requires --auto-resolve=full"

### Requirement: `--auto-resolve` MUST validate `full` as an accepted mode

`gx branch finish` MUST accept exactly three `--auto-resolve` values: `none`, `safe`, `full`. Any other value MUST cause the script to exit non-zero before performing any merge or push.

#### Scenario: Invalid mode is rejected

- **GIVEN** the user invokes `gx branch finish --auto-resolve=aggressive ...`
- **THEN** the script exits non-zero with `Invalid --auto-resolve value: aggressive (expected none|safe|full)`
