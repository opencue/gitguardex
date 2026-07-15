## ADDED Requirements

### Requirement: --no-auto-promote holds the merge in the finish PR flow
`gx branch finish` with `--no-auto-promote` (or `GUARDEX_FINISH_AUTO_PROMOTE=0`) SHALL treat the flag as a merge hold: the PR is opened but never merged by the finish run.

#### Scenario: PR opened as draft, merge never attempted
- **WHEN** `gx branch finish --via-pr --no-auto-promote` runs against a repo whose host supports draft PRs
- **THEN** the PR is created with `--draft`
- **AND** no `gh pr merge` invocation (immediate, `--auto`, or merge-wait polling) occurs
- **AND** the command exits 0 with the agent branch, remote branch, and worktree retained
- **AND** the output names the hold and how to lift it (`gh pr ready`, then rerun `gx branch finish`)

#### Scenario: draft unsupported falls back to ready PR, hold still applies
- **WHEN** the host rejects draft PR creation (e.g. private repo on a plan without drafts)
- **THEN** the finish retries `gh pr create` without `--draft`
- **AND** the merge is still not attempted

#### Scenario: hold forces the PR path
- **WHEN** `--no-auto-promote` is combined with `--mode auto`
- **THEN** the finish uses the PR flow (no direct push to the base branch)
- **WHEN** `--no-auto-promote` is combined with `--direct-only`
- **THEN** the finish exits non-zero with an error naming the conflict

#### Scenario: default flow unchanged
- **WHEN** `gx branch finish --via-pr` runs without `--no-auto-promote`
- **THEN** the PR is created ready, merged, and cleaned up as before
