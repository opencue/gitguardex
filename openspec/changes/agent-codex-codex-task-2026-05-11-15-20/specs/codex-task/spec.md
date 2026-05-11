## ADDED Requirements

### Requirement: Local PR Review Runner
The system SHALL provide a `gx pr-review` command that reviews a GitHub pull request using an authenticated local agent CLI without requiring OpenAI or Anthropic API tokens.

#### Scenario: Review with GitHub posting
- **WHEN** `gx pr-review --provider codex --pr <number> --post` runs in a repository with GitHub auth
- **THEN** the command reads the pull request diff through `gh pr diff <number>`
- **AND** sends a compact structured-review prompt to the selected local provider
- **AND** posts one GitHub review containing inline comments for returned findings.

#### Scenario: Review without GitHub auth
- **WHEN** `gx pr-review --provider claude --pr <number> --post` runs without `GITHUB_TOKEN`, `GH_TOKEN`, or usable `gh auth`
- **THEN** the command does not require model API credentials
- **AND** writes a markdown review artifact containing the structured findings instead of posting.
