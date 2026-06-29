## ADDED Requirements

### Requirement: Auto-finish sweep honors the GUARDEX_AUTO_SHIP merge gate
The doctor auto-finish sweep SHALL honor the `GUARDEX_AUTO_SHIP` merge gate when the toggle is enabled. The sweep SHALL enforce the same merge gate as interactive `gx finish` (clean AI review + green CI + GitHub-mergeable) before merging a ready `agent/*` branch into base via the PR path. The gate SHALL apply only to the PR path; direct and local fallback merges, which have no PR or CI to gate, SHALL pass through unchanged. When `GUARDEX_AUTO_SHIP` is unset or falsy, the sweep SHALL behave exactly as before this change.

#### Scenario: Toggle off leaves the sweep ungated
- **WHEN** `GUARDEX_AUTO_SHIP` is unset or falsy and the sweep finishes a ready branch
- **THEN** the merge gate is not invoked
- **AND** the branch is merged using the prior sweep behavior.

#### Scenario: Toggle on gates a PR-path merge
- **WHEN** `GUARDEX_AUTO_SHIP` is enabled and a ready branch would merge via the PR path
- **THEN** the review gate runs for that branch before any merge
- **AND** the branch merges only if the gate passes.

#### Scenario: Gate failure skips the branch
- **WHEN** the review gate blocks a branch (failing review, red CI, or not mergeable)
- **THEN** the sweep records a skip for that branch with the gate reason
- **AND** the branch is not merged.

#### Scenario: Non-PR fallback merges are not gated
- **WHEN** `GUARDEX_AUTO_SHIP` is enabled but the branch finishes via the direct or local fallback
- **THEN** the review gate is not invoked
- **AND** the branch merges through the fallback path unchanged.
