## ADDED Requirements

### Requirement: Colony-ready agent start planning
`gx agents start <task> --dry-run --json` SHALL emit a versioned JSON plan that can be consumed by Colony or a cockpit integration without parsing human text.

#### Scenario: Previewing a Colony handoff lane
- **WHEN** a user runs `gx agents start "fix handoff" --agent codex --claim README.md --meta colony.plan=queen-plan --dry-run --json`
- **THEN** Guardex emits `schemaVersion`, `dryRun`, `task`, `agent`, `base`, `branch`, `worktree`, `worktreePath`, `claimedFiles`, `launchCommand`, `tmuxSession`, `tmuxTarget`, and `metadata`
- **AND** the command does not create a branch, worktree, session, file claim, tmux session, or agent process.

### Requirement: Colony-ready agent status
`gx agents status --json` SHALL expose session metadata needed to inspect, adopt, or finish active agent lanes.

#### Scenario: Inspecting a Queen-plan lane
- **WHEN** a session stores Colony metadata, claimed files, changed files, launch command, and PR evidence
- **THEN** the status payload includes `activity`, `claimedFiles`, `changedFiles`, `metadata`, `launchCommand`, `tmux`, `prUrl`, `prState`, and `pr`
- **AND** cockpit state preserves the same fields for rendering.

### Requirement: Finish evidence JSON
`gx agents finish --json` SHALL emit versioned completion evidence and persist that evidence to the session record.

#### Scenario: Finishing a merged lane
- **WHEN** a finish command completes with PR output and cleanup enabled
- **THEN** Guardex emits `schemaVersion`, `sessionId`, `branch`, `prUrl`, `mergeState`, `cleanupResult`, and `status`
- **AND** the matching agent session records the PR state and finish evidence for later status and handoff surfaces.
