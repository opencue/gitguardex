## ADDED Requirements

### Requirement: Default base-branch detection
When no base branch is explicitly provided or configured, the system SHALL detect the repository's real default branch instead of assuming a hardcoded fallback.

#### Scenario: Remote default via origin/HEAD
- **WHEN** base resolution finds no explicit and no configured base and `origin/HEAD` resolves
- **THEN** the system uses the branch named by `origin/HEAD`

#### Scenario: First existing conventional branch
- **WHEN** `origin/HEAD` is unset and no base is configured
- **THEN** the system uses the first existing branch among `main`, `master`, `dev` (local or on origin)

#### Scenario: Hardcoded fallback
- **WHEN** there is no `origin/HEAD`, no configured base, and none of `main` / `master` / `dev` exist
- **THEN** the system falls back to `DEFAULT_BASE_BRANCH`

#### Scenario: Per-branch finish base takes precedence
- **WHEN** resolving the finish base and `branch.<source>.guardexBase` is set for the source branch
- **THEN** that per-branch value is used ahead of the repo-wide configured base and detection
