## ADDED Requirements

### Requirement: Single canonical base-branch detector
Base-branch detection SHALL have one implementation. The PR flow SHALL resolve the base branch via the canonical `detectDefaultBaseBranch` (in `src/git/index.js`) rather than a separate, drift-prone copy.

#### Scenario: PR base uses the canonical detector
- **WHEN** the PR flow needs a base branch and no explicit `--base` is given
- **THEN** it resolves the base via `detectDefaultBaseBranch` (origin/HEAD → main/master/dev → DEFAULT_BASE_BRANCH)

#### Scenario: No duplicate detector remains
- **WHEN** the codebase is searched for base-branch detection
- **THEN** `src/pr.js` exposes no separate `detectBaseBranch` implementation
