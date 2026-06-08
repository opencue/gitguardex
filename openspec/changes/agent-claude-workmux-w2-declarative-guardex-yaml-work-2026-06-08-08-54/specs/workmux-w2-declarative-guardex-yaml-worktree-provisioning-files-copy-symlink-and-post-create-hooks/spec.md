## ADDED Requirements

### Requirement: Declarative worktree provisioning config
The system SHALL read an optional `.guardex.json` at the repo root and, when it
contains a `provision` object, apply it to a freshly created agent worktree. The
config SHALL be parsed permitting comments and trailing commas. A missing file,
unparseable JSON, or a missing `provision` block SHALL be treated as "no
declarative provisioning" without error. `provision.files.copy`,
`provision.files.symlink`, and `provision.postCreate` SHALL each normalize to a
list of non-empty strings, dropping any other value.

#### Scenario: Config is loaded and normalized
- **WHEN** a repo's `.guardex.json` has `provision.files.copy` of `[".env", 5]`
- **THEN** the loaded copy list is `[".env"]` (the non-string is dropped).

#### Scenario: Absent or malformed config is inert
- **WHEN** there is no `.guardex.json`, or it is malformed, or it has no
  `provision` block
- **THEN** provisioning loads nothing and the worktree is created normally.

### Requirement: Copy and symlink provisioning into the worktree
For each `files.copy` pattern the system SHALL copy each matching repo-root file
into the worktree at the same relative path; for each `files.symlink` pattern it
SHALL create a symlink in the worktree pointing at the repo-root path. Existing
worktree paths SHALL NOT be overwritten. Copy SHALL apply to files only
(directories are skipped with a note; use symlink for directories). Patterns
SHALL support literal segments and a single-segment `*` wildcard (e.g.
`apps/*/.env`); patterns that are absolute or contain `..` SHALL be rejected.

#### Scenario: Files copied, directories symlinked
- **WHEN** `copy` is `[".env"]` and `symlink` is `["node_modules"]` for a repo
  that has both
- **THEN** the worktree gets a real copy of `.env` and a symlink `node_modules`
  pointing at the repo root
- **AND** re-running leaves the already-present entries unchanged.

#### Scenario: Unsafe pattern rejected
- **WHEN** a pattern is `../secrets` or `/etc/passwd`
- **THEN** it matches nothing and no file outside the repo is touched.

### Requirement: post_create hooks with a trust boundary
For each `provision.postCreate` command the system SHALL run it as a shell
command with the worktree as the working directory and with `GUARDEX_WORKTREE`
and `GUARDEX_REPO_ROOT` in the environment. Hooks SHALL run only from the trusted
repo-root config, SHALL be non-fatal (a failing hook is recorded, not thrown),
and SHALL be skippable via `GUARDEX_PROVISION_HOOKS=0`.

#### Scenario: Hook runs in the worktree
- **WHEN** `postCreate` is `["pnpm install"]`
- **THEN** the command runs with cwd = the worktree and `GUARDEX_WORKTREE` set.

#### Scenario: Hooks disabled
- **WHEN** `GUARDEX_PROVISION_HOOKS=0` is set
- **THEN** no postCreate command runs and each is recorded as skipped.

### Requirement: Provisioning runs for any repo layout
Declarative provisioning SHALL run on worktree creation regardless of whether the
repo has an `apps/*` monorepo layout, and SHALL NOT regress the existing `apps/*`
env-symlink and per-app dev-port behavior.

#### Scenario: Non-monorepo repo is provisioned
- **WHEN** a repo with no `apps/` directory has a `.guardex.json` provision block
  and a worktree is prepared
- **THEN** the declared copy/symlink operations are applied to the worktree.
