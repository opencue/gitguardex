## ADDED Requirements

### Requirement: gx auto-recognizes submodules at branch start
`gx branch start` SHALL parse `.gitmodules` (when present), run `git
submodule status` inside the new worktree, classify every submodule
as `clean | dirty | uninitialized | missing-remote`, persist the
classification at
`.omc/agent-worktrees/<slug>/.guardex/submodules.json`, and run `git
submodule update --init --recursive` inside the worktree unless
`GUARDEX_SUBMODULE_INIT=0` is set in the environment.

#### Scenario: Clean repo with five configured submodules
- **WHEN** `gx branch start "<task>" "<agent>"` runs in a worktree
  whose `.gitmodules` lists five submodules and `git submodule
  status` reports all five as initialized
- **THEN** `submodules.json` contains exactly five entries
- **AND** every entry has `state: "clean"` and a non-null
  `parent_gitlink_sha`
- **AND** the worktree's submodule paths each contain a populated
  `.git` file or directory (init succeeded).

#### Scenario: Uninitialized submodule with on-disk modifications
- **WHEN** `gx branch start` runs in a repo where `git submodule
  status` reports `examples/hive` with a `-` prefix and `git status`
  reports `m examples/hive`
- **THEN** the manifest entry for `examples/hive` records
  `state: "dirty"` and `was_uninitialized: true`
- **AND** finish-time refusal is set on the entry so a future `gx
  branch finish` cannot silently push stranded edits.

#### Scenario: Operator opts out of init
- **WHEN** `GUARDEX_SUBMODULE_INIT=0 gx branch start ...` runs
- **THEN** `git submodule update --init` is NOT invoked
- **AND** the manifest still records `state: "uninitialized"` for
  every uninitialized submodule
- **AND** the start log prints `submodule init: skipped
  (GUARDEX_SUBMODULE_INIT=0)`.

### Requirement: File locks key on (submodule_root, relative_path)
`scripts/agent-file-locks.py` SHALL key claim records on the tuple
`(submodule_root, relative_path)` rather than the bare absolute or
parent-relative path. The same relative path inside the parent repo
and inside a submodule SHALL NOT collide.

#### Scenario: Same filename in parent and submodule
- **WHEN** branch `agent/claude/foo` claims
  `examples/hive/src/index.js` and branch `agent/codex/bar` claims
  `src/index.js` in the parent
- **THEN** both claims succeed
- **AND** the locks file records two distinct entries with
  `submodule_root` values `"examples/hive"` and `""` respectively.

#### Scenario: Cross-branch collision inside the same submodule
- **WHEN** branch `agent/claude/foo` already holds
  `examples/hive/src/index.js` and branch `agent/codex/bar` attempts
  to claim the same path
- **THEN** the second claim fails with exit code `2`
- **AND** the failure message identifies the holder branch and the
  submodule root.

#### Scenario: Legacy lock entries remain readable
- **WHEN** the locks file already contains an entry written by the
  pre-tuple format (bare path string)
- **THEN** `agent-file-locks.py status` lists it without crashing
- **AND** any new claim involving that path is rewritten to the
  tuple format on first contact.

### Requirement: gx finish atomically bumps parent gitlinks
`gx branch finish` SHALL stage parent-repo gitlink updates for all
dirty submodules in **exactly one** parent commit, and SHALL stage
that commit only after every submodule PR has reached merge state
`MERGED`. On any submodule failure the parent SHALL NOT receive a
gitlink bump for any submodule, and finish SHALL exit with status
`BLOCKED` and a recovery hint.

#### Scenario: All submodule PRs merge
- **WHEN** `gx branch finish ... --via-pr --wait-for-merge` runs
  with three dirty submodules and all three child PRs reach
  `MERGED`
- **THEN** the parent's last commit before the parent PR is opened
  has subject `chore(submodules): bump gitlinks for <slug>`
- **AND** the commit's diff updates exactly three gitlink entries
- **AND** no parent commit was pushed earlier than the final bump.

#### Scenario: One submodule PR fails to merge
- **WHEN** two child PRs reach `MERGED` and the third is closed
  without merge
- **THEN** finish exits non-zero with a `BLOCKED:` line that
  includes the failed submodule path and its PR URL
- **AND** `git -C <parent> diff --name-only HEAD` lists no
  submodule path bumps
- **AND** the manifest records `parent_bump: "skipped"` with a
  `reason` field.

#### Scenario: `commit-only` mode skips PR step
- **WHEN** `GUARDEX_SUBMODULE_MODE=commit-only gx branch finish ...`
  runs with one dirty submodule
- **THEN** the submodule's topic branch is pushed but no `gh pr
  create` is issued
- **AND** the parent's gitlink bump targets the pushed topic
  branch's HEAD SHA
- **AND** the finish report records `mode: "commit-only"`.

### Requirement: gx preflights cross-org token write permission
`gx branch start` SHALL probe write permission on every github.com
submodule remote using the active `GITHUB_TOKEN`, and SHALL fail
fast if any submodule is unreachable or its token-derived
permission level is below `push`. Non-github.com remotes SHALL be
recorded as `permission: "unverified"` without failing start.

#### Scenario: Token has push on every submodule remote
- **WHEN** `gx branch start` runs with five github.com submodules
  and `GET /repos/<owner>/<repo>` returns
  `"permissions": {"push": true}` for each
- **THEN** start completes
- **AND** the manifest's `preflight` field is `"ok"` for every
  submodule.

#### Scenario: Token lacks push on one submodule
- **WHEN** start runs and `repos/<owner>/<repo>` for one submodule
  returns `"permissions": {"push": false, "pull": true}`
- **THEN** start exits non-zero with a message naming the
  unreachable repo and the remediation
  (`gh auth refresh -s repo` or token rotation)
- **AND** no worktree is left dirty (start cleans up the partial
  scaffold).

#### Scenario: Self-hosted git remote
- **WHEN** a submodule URL points to `git.internal.example.com`
- **THEN** the manifest entry records `permission: "unverified"`
  and `host: "git.internal.example.com"`
- **AND** start does not block on that submodule.
