## ADDED Requirements

### Requirement: A completed merge SHALL be reported as success
`gx branch finish` SHALL announce the merge as soon as it is confirmed and
before any cleanup step runs, and SHALL NOT report a non-zero exit status for
a run whose merge landed.

#### Scenario: Merge lands and cleanup is clean
- **WHEN** the PR merges and every cleanup step succeeds
- **THEN** the run prints `✅ MERGED <source> -> <base>` and the PR URL
- **AND** the run exits 0.

#### Scenario: Merge lands but the local branch cannot be deleted
- **WHEN** the PR merges and `git branch -d` refuses the source branch
- **THEN** the run prints `✅ MERGED <source> -> <base>` before the refusal
- **AND** the run warns that the branch was kept, naming the inspect and
  delete commands
- **AND** the run exits 0.

### Requirement: A refused branch delete SHALL be resolved by merge evidence
When `git branch -d` refuses the source branch after a merge, the system SHALL
consult GitHub for a merged PR whose head SHA equals that branch's head, and
SHALL force the delete only when such a PR exists.

#### Scenario: Squash merge left no ancestor link
- **WHEN** `git branch -d` refuses and a merged PR records this exact head SHA
- **THEN** the branch is force-deleted
- **AND** the closing summary reports the branch as cleaned.

#### Scenario: Branch holds commits that never landed
- **WHEN** `git branch -d` refuses and no merged PR records this head SHA
- **THEN** the local branch is kept
- **AND** the remote branch is kept
- **AND** the follow-up prune is invoked without `--delete-branches` and
  without `--delete-remote-branches`
- **AND** the closing summary reports the branch as kept.
