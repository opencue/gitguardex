## ADDED Requirements

### Requirement: Active Agents SCM commit box targets the selected sandbox
The Guardex Active Agents VS Code companion SHALL expose a native SCM commit input that targets the currently selected `gitguardex.activeAgents` session worktree.

#### Scenario: Accept input commits the selected session worktree
- **WHEN** the operator selects a live Active Agents session and accepts the SCM input
- **THEN** the companion stages the selected session worktree with `git add -A`
- **AND** it excludes `.omx/state/agent-file-locks.json` from that stage operation
- **AND** it runs `git commit -m <message>` against the selected session's `worktreePath`.

#### Scenario: Header commit affordance uses the same selected session
- **WHEN** the operator activates the view-header commit command while a live session is selected
- **THEN** the companion uses the same SCM input message
- **AND** it commits the same selected session worktree instead of prompting for a different target.

#### Scenario: Missing selection degrades safely
- **WHEN** the operator accepts the SCM input or clicks the header commit affordance without a selected session
- **THEN** the companion does not run any git command
- **AND** it shows an information message telling the operator to pick a session first.
