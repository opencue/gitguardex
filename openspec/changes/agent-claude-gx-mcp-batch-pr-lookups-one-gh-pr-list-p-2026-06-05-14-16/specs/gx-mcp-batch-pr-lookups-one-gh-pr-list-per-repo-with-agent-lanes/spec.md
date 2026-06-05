## ADDED Requirements

### Requirement: Batch PR correlation for list_agents
`list_agents` SHALL correlate agent lanes to their open PRs using a single
`gh pr list` call per repository, and SHALL only invoke gh for repositories that
have at least one agent lane.

#### Scenario: One gh call per repo with lanes
- **WHEN** `list_agents` runs with PR lookup enabled
- **THEN** each scanned repository that has ≥1 agent lane triggers exactly one `gh pr list` call, and repositories with no lanes trigger none.

#### Scenario: PRs on by default
- **WHEN** `list_agents` is called without `include_prs`
- **THEN** PR state is fetched and attached to each lane (matched by branch / headRefName)
- **AND** passing `include_prs:false` skips gh entirely.

#### Scenario: Graceful degradation
- **WHEN** gh is missing, unauthenticated, or offline
- **THEN** `listOpenPrsForRepo` returns an empty list, lanes report `pr: null`, and the call still succeeds.
