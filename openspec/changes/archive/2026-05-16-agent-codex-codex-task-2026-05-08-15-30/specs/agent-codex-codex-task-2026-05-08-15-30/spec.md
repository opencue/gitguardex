## ADDED Requirements

### Requirement: Agent completion uses Guardex finish flow
Managed agent guidance SHALL instruct agents to complete work through `gx branch finish --branch "<agent-branch>" --via-pr --wait-for-merge --cleanup` or `gx finish --all` instead of standalone `git push` / `gh pr` commands.

#### Scenario: Completion policy avoids raw push prompts
- **WHEN** `gx install` writes the managed multi-agent policy block
- **THEN** the completion policy names the Guardex finish command as the required path
- **AND** the policy tells agents not to use standalone `git push` / `gh pr` commands for completion.
