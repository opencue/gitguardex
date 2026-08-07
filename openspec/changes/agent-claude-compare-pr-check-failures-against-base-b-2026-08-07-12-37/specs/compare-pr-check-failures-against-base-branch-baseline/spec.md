## ADDED Requirements

### Requirement: The merge gate SHALL support gating on new failures instead of absolute green

With `--gate-baseline`, the CI gate SHALL treat a failing check as blocking only
when that check is not already failing on the base. Without the flag, behavior
SHALL be unchanged: any failing or cancelled check blocks.

#### Scenario: A check is already failing on the base

- **WHEN** a PR check fails and a check of the same name is already failing on the base
- **THEN** that failure SHALL NOT block the merge

#### Scenario: A check fails that is not failing on the base

- **WHEN** a PR check fails and no check of that name is failing on the base
- **THEN** the gate SHALL block
- **AND** the error SHALL name the new failure and the base branch it was compared against

#### Scenario: The flag is not set

- **WHEN** any check fails and `--gate-baseline` is absent
- **THEN** the gate SHALL block
- **AND** the error SHALL mention `--gate-baseline` as an available option

#### Scenario: A failing check cannot be named

- **WHEN** the count of failing checks exceeds the number of resolvable check names
- **THEN** the gate SHALL block, because an unnamed failure cannot be proven pre-existing

### Requirement: Baseline mode SHALL NOT relax anything GitHub itself refuses

Baseline mode SHALL widen the accepted merge states by exactly `UNSTABLE`, which
is what GitHub reports for a red non-required check. `BLOCKED`, `DIRTY`, and
`BEHIND` SHALL continue to block.

#### Scenario: GitHub reports a state it will not merge

- **WHEN** `mergeStateStatus` is `BLOCKED`, `DIRTY`, or `BEHIND` in baseline mode
- **THEN** the gate SHALL block

#### Scenario: A check is still running

- **WHEN** a check is pending in baseline mode
- **THEN** the gate SHALL keep waiting rather than pass

#### Scenario: A check reports an ambiguous state

- **WHEN** a check is in a state that is neither success nor a known failure
- **THEN** the gate SHALL NOT report green

### Requirement: The baseline SHALL be read from the base branch and the last merged PR

`baselineFailures` SHALL union the failing check names on the base branch HEAD
with those on the head commit of the most recently merged PR into that base.

#### Scenario: CI runs only on pull_request

- **WHEN** the base branch HEAD carries no run of the check in question
- **THEN** the last merged PR's checks SHALL still contribute to the baseline

#### Scenario: Neither source has any checks

- **WHEN** no checks are observable on either source
- **THEN** the baseline SHALL be empty and its source SHALL be reported as unavailable
- **AND** every PR failure SHALL therefore count as new

#### Scenario: The GitHub API is unreachable

- **WHEN** a baseline query fails
- **THEN** it SHALL contribute nothing rather than be treated as green
