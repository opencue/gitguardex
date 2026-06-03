## ADDED Requirements

### Requirement: Opt-in merge gate is off by default
`gx branch finish` SHALL NOT enforce the review/CI merge gate unless the gate is
explicitly enabled. The gate is enabled by `--gate-review` and disabled by
`--no-gate-review` / `--skip-review-gate`. `gx ship` SHALL enable the gate by
default unless the caller passes `--no-gate-review` or `--skip-review-gate`.

#### Scenario: Default finish does not gate
- **WHEN** `gx branch finish --via-pr --wait-for-merge` runs without `--gate-review`
- **THEN** behavior is unchanged from before this change
- **AND** no review and no extra CI polling is performed

#### Scenario: gx ship enables the gate
- **WHEN** `gx ship` runs without an opt-out flag
- **THEN** the finish options have `gateReview` enabled

### Requirement: Enabled gate enforces clean review and green CI before merge
When the gate is enabled for a PR-mode finish, the system SHALL refuse to merge a
branch unless its PR passes a clean AI review AND CI is green AND GitHub reports
the PR mergeable. The gate SHALL run before the merge and SHALL fail closed.

#### Scenario: Blocking review finding stops the merge
- **WHEN** the AI review reports a high or critical finding
- **THEN** the gate throws and the branch is not merged

#### Scenario: Review provider did not run
- **WHEN** the review provider errors, times out, or returns no output
- **THEN** the gate treats it as a block, never as a clean pass

#### Scenario: Failed or cancelled CI blocks the merge
- **WHEN** any required check is failed or cancelled
- **THEN** the gate refuses to merge

#### Scenario: GitHub reports the PR not mergeable
- **WHEN** `mergeStateStatus` is `BLOCKED`, `DIRTY`, `BEHIND`, or `UNSTABLE`
- **THEN** the gate refuses to merge

#### Scenario: PR has no CI checks
- **WHEN** the PR has no checks after a grace window and `--allow-no-checks` was not passed
- **THEN** the gate refuses to merge an unverified PR
