## ADDED Requirements

### Requirement: --no-auto-promote holds the merge in the finish PR flow
`gx branch finish` with `--no-auto-promote` (or `GUARDEX_FINISH_AUTO_PROMOTE=0`) SHALL treat the flag as a merge hold: the PR is opened but never merged by the finish run.

#### Scenario: PR opened as draft, merge never attempted
- **WHEN** `gx branch finish --via-pr --no-auto-promote` runs against a repo whose host supports draft PRs
- **THEN** the PR is created with `--draft`
- **AND** no `gh pr merge` invocation (immediate, `--auto`, or merge-wait polling) occurs
- **AND** the command exits 0 with the agent branch, remote branch, and worktree retained
- **AND** the output includes a machine-readable `MERGE_HELD=1` trailer and how to lift the hold

#### Scenario: placing the hold disarms primed merge paths
- **WHEN** the hold is placed on a PR that is already ready or has GitHub auto-merge enabled
- **THEN** auto-merge is disabled (`gh pr merge --disable-auto`) and the PR is demoted to draft (`gh pr ready --undo`), best-effort

#### Scenario: draft unsupported falls back to ready PR, hold still applies
- **WHEN** the host rejects draft PR creation (e.g. private repo on a plan without drafts)
- **THEN** the finish retries `gh pr create` without `--draft`
- **AND** the merge is still not attempted

#### Scenario: hold forces the PR path
- **WHEN** `--no-auto-promote` is combined with `--mode auto`
- **THEN** the finish uses the PR flow (no direct push to the base branch)
- **WHEN** `--no-auto-promote` is combined with `--direct-only`
- **THEN** the finish exits non-zero with an error naming the conflict

### Requirement: the merge hold persists across finish re-runs
The hold SHALL be persisted as a `guardex:merge-hold` marker in the PR body, and every finish PR-flow run SHALL honor the marker before promoting or merging. Only an explicit `--auto-promote` flag lifts it.

#### Scenario: unflagged re-run does not lift the hold
- **WHEN** a held lane is finished again WITHOUT `--no-auto-promote` (e.g. by the Claude stop hook, the doctor auto-finish sweep, or `gx finish --all`)
- **THEN** the run reports the existing hold, does not promote the draft, does not merge, and exits 0 with state retained

#### Scenario: explicit --auto-promote lifts the hold
- **WHEN** `gx branch finish --auto-promote` runs on a held lane
- **THEN** the marker is removed, the draft is promoted, and the merge + cleanup proceed
- **AND** `GUARDEX_FINISH_AUTO_PROMOTE=1` or the default value SHALL NOT lift the marker

#### Scenario: marker removal failure keeps the hold
- **WHEN** removing the marker fails
- **THEN** the run continues to treat the PR as held and does not merge

#### Scenario: default flow unchanged
- **WHEN** `gx branch finish --via-pr` runs without `--no-auto-promote` on a lane with no hold marker
- **THEN** the PR is created ready, merged, and cleaned up as before
