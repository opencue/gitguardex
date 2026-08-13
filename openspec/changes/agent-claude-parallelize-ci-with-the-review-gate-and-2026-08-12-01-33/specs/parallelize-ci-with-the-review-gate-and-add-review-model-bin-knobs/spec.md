## ADDED Requirements

### Requirement: CI runs alongside the review gate
The merge gate SHALL promote the pull request to ready before running the AI
review, so CI and the review proceed concurrently. The gate SHALL still require
both a clean review and green CI before it returns, and SHALL throw on either
failure so no merge runs.

#### Scenario: Default gate overlaps CI with the review
- **WHEN** `gx branch finish --gate-review` runs without `--gate-serial-ci`
- **THEN** the pull request is promoted to ready before the review provider runs
- **AND** the CI wait begins only after the review returns a clean verdict
- **AND** a blocking finding still throws before the CI wait is reached

#### Scenario: Serial mode holds CI back
- **WHEN** `--gate-serial-ci` is passed
- **THEN** the pull request is promoted only after the review comes in clean
- **AND** a review that was never posted leaves the pull request unpromoted

### Requirement: The CI verdict SHALL describe the commit being merged
When the gate itself pushes a commit during the run, the CI wait SHALL be
pinned to that commit. A status snapshot whose head differs from the pinned
commit, or that carries no head at all, SHALL NOT be accepted as green.

#### Scenario: Auto-fix commit pins the CI wait
- **WHEN** a `--gate-autofix` round commits and pushes a repair
- **THEN** the CI wait is pinned to the pushed commit

#### Scenario: A stale rollup blocks the merge
- **WHEN** the pull request head still reports the commit the push replaced
- **THEN** the gate keeps polling until the head catches up
- **AND** it returns `stale-head` at the deadline, which the gate turns into a block

#### Scenario: An unknown head is treated as stale
- **WHEN** the status snapshot carries no head commit while a pin is in force
- **THEN** the wait refuses to report green

### Requirement: Review model, binary, and timeout are selectable
The review runner SHALL accept an explicit model, an explicit provider binary,
and an explicit provider timeout. Precedence for model and binary selection is
explicit option, then environment, then an automatic provider default.

#### Scenario: Model selection
- **WHEN** `--review-model sonnet` or `GUARDEX_REVIEW_MODEL=sonnet` is set
- **THEN** the provider is invoked with its own model flag and that value
- **AND** an absent setting leaves the provider default untouched

#### Scenario: Binary selection
- **WHEN** `GUARDEX_REVIEW_CLAUDE_BIN` or `GUARDEX_REVIEW_CODEX_BIN` names a path
- **THEN** the review runs that binary instead of resolving the provider name on PATH

#### Scenario: Cue shims are bypassed by default
- **WHEN** PATH resolves `claude` or `codex` to Cue's `cue launch ...` shim
- **THEN** the review runner skips that shim and runs the real provider binary
  behind it when one exists

#### Scenario: Review timeout selection
- **WHEN** `--review-timeout-ms 60000` is passed to the merge gate
- **THEN** the provider review run receives `timeoutMs=60000`

#### Scenario: A named model must have a value
- **WHEN** `--review-model` is passed with no value, or with another flag as its value
- **THEN** the command fails rather than falling back to the default model

#### Scenario: A named review timeout must be positive
- **WHEN** `--review-timeout-ms` is passed with no value, zero, or a non-integer
- **THEN** the command fails rather than falling back to the default timeout
