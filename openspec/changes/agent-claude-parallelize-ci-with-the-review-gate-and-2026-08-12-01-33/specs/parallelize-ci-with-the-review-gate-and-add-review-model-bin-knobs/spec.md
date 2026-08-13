## ADDED Requirements

### Requirement: The review gate preserves the draft barrier by default
The merge gate SHALL keep the pull request in draft while the AI review runs by
default, preserving GitHub's draft-PR merge block until the review verdict is
known. The gate SHALL still require both a clean review and green CI before it
returns, and SHALL throw on either failure so no merge runs.

#### Scenario: Default gate holds CI until the review is clean
- **WHEN** `gx branch finish --gate-review` runs without `--no-gate-serial-ci`
- **THEN** the pull request is promoted to ready only after the review provider
  posts a clean review
- **AND** a review that was never posted leaves the pull request unpromoted

#### Scenario: Existing ready PRs are redrafted before review
- **WHEN** `gx branch finish --gate-review` finds an existing pull request that
  is no longer draft
- **THEN** the gate attempts to return it to draft before invoking the review
  provider
- **AND** a failed redraft attempt blocks the merge

#### Scenario: Explicit parallel mode overlaps CI with the review
- **WHEN** `--no-gate-serial-ci` is passed
- **THEN** the pull request is promoted to ready before the review provider runs
- **AND** the CI wait begins only after the review returns a clean verdict
- **AND** a blocking finding still throws before the CI wait is reached

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

#### Scenario: Pending required checks are not terminal merge blocks
- **WHEN** GitHub reports `mergeStateStatus=BLOCKED` or `UNSTABLE` while status
  checks are still pending
- **THEN** the CI wait keeps polling instead of treating the merge state as a
  terminal block

#### Scenario: Baseline-red checks can explain a blocked merge state
- **WHEN** `--gate-baseline` is active, every failed check is already failing on
  the base, and GitHub still reports the PR branch as mergeable
- **THEN** `mergeStateStatus=BLOCKED` is treated as the known baseline-red check
  state rather than a new merge blocker

#### Scenario: An unknown head is treated as stale
- **WHEN** the status snapshot carries no head commit while a pin is in force
- **THEN** the wait refuses to report green

### Requirement: Review model, binary, and timeout are selectable
The review runner SHALL accept an explicit model, an explicit provider binary,
and an explicit provider timeout. Precedence for model and binary selection is
explicit option, then environment, then an automatic provider default. Claude
review/fix invocations SHALL run in safe mode so local hooks, MCP servers, and
project customizations do not block a noninteractive review.

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

#### Scenario: Claude reviews avoid interactive customizations
- **WHEN** the review or auto-fix provider is `claude`
- **THEN** the provider command includes `--safe-mode`
- **AND** the command still uses `-p` print mode plus any selected model or fix permission flag

#### Scenario: Review timeout selection
- **WHEN** `--review-timeout-ms 60000` is passed to the merge gate
- **THEN** the provider review run receives `timeoutMs=60000`

#### Scenario: Malformed provider output is retried once
- **WHEN** the review provider exits successfully but returns prose instead of
  parseable findings JSON
- **THEN** the review runner retries the provider once with the same timeout
- **AND** a second malformed answer still fails closed

#### Scenario: A named model must have a value
- **WHEN** `--review-model` is passed with no value, or with another flag as its value
- **THEN** the command fails rather than falling back to the default model

#### Scenario: A named review timeout must be positive
- **WHEN** `--review-timeout-ms` is passed with no value, zero, or a non-integer
- **THEN** the command fails rather than falling back to the default timeout

### Requirement: GitHub API routes use the canonical repository slug
GitHub API helpers SHALL resolve the repository's canonical `owner/name` with
`gh repo view` before constructing `repos/...` API paths. If that resolution is
unavailable, they SHALL fall back to the GitHub CLI's `repos/:owner/:repo`
placeholder rather than blocking offline callers.

#### Scenario: A moved remote still receives review posts
- **WHEN** a checkout remote points at an old owner/name but `gh repo view`
  resolves the current canonical owner/name
- **THEN** review comment fingerprint fetches and review post calls use
  `repos/<canonical-owner>/<canonical-name>/pulls/...`

#### Scenario: Canonical route lookup is best-effort
- **WHEN** `gh repo view` cannot resolve a valid owner/name
- **THEN** API paths fall back to `repos/:owner/:repo/...`
