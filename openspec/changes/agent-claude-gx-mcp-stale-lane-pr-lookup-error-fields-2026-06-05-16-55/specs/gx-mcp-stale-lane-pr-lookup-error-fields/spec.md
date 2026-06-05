## ADDED Requirements

### Requirement: Distinguish PR-lookup failure from no open PR
The collector SHALL set a `prLookupError` field on each lane: the error string when the `gh` PR lookup itself failed, or null when the lookup succeeded (including when it found no open PR).

#### Scenario: gh lookup fails
- **WHEN** PR lookup runs against a repo where `gh` cannot list (missing, unauthenticated, offline, or no remote)
- **THEN** each lane's `prLookupError` is a non-empty string and its `pr` is null.

#### Scenario: PRs not requested
- **WHEN** `include_prs` is false
- **THEN** `prLookupError` is null (no lookup attempted).

### Requirement: Flag stale lanes
The collector SHALL set `ageDays` (whole days since the lane's last commit) and `stale` (true when ageDays exceeds the threshold AND the lane has no open PR AND no uncommitted changes) on each lane. The threshold SHALL default to 14 days, overridable via `GUARDEX_MCP_STALE_DAYS`.

#### Scenario: Old idle lane is stale
- **WHEN** a lane's last commit is older than the threshold, with no open PR and a clean tree
- **THEN** `stale` is true.

#### Scenario: Fresh or active lane is not stale
- **WHEN** a lane's last commit is recent (or it has an open PR or uncommitted work)
- **THEN** `stale` is false.
