## ADDED Requirements

### Requirement: Record per-session live editing presence
On every Claude Code `Edit`/`Write`/`MultiEdit`, the PostToolUse tracker SHALL
upsert a per-session presence record under `.claude/hooks/state/session-<id>.json`
capturing the edited file (repo-relative), the branch, the worktree, and a fresh
`last_seen` heartbeat. Recording SHALL cover all in-tree files (not only Python),
and SHALL exclude runtime/bookkeeping paths (`.claude/`, `.omx/`, `.omc/`,
`.git/`, `.codex/`, `__pycache__/`) and any path outside the worktree.

#### Scenario: An edit is recorded as presence
- **WHEN** a session edits `src/storefront/account.tsx`
- **THEN** `session-<id>.json` lists `src/storefront/account.tsx` as `current_file`
- **AND** `last_seen` is refreshed to the time of the edit.

### Requirement: Surface other live sessions to the agent
The SessionStart / UserPromptSubmit advisor SHALL report OTHER sessions that have
a live presence record in the SAME worktree, on ANY branch (agent worktrees
included), as an `additionalContext` banner. A session SHALL NOT be shown its own
record. Presence reporting SHALL be scoped to the current worktree.

#### Scenario: A sibling session's edit is surfaced
- **WHEN** session A edits `account.tsx` and session B starts in the same worktree
- **THEN** session B's banner names session A and `account.tsx`.

#### Scenario: A session does not see itself
- **WHEN** session A is the only session with a presence record
- **THEN** the advisor produces no presence banner for session A.

### Requirement: Liveness window
A presence record SHALL count as live only when its `last_seen` is within a
sliding window (default 900 seconds, overridable via
`GUARDEX_PRESENCE_WINDOW_SEC`). A record older than the window SHALL be omitted.

#### Scenario: A stale session drops off
- **WHEN** a session's last edit is older than the configured window
- **THEN** it is not shown in the presence banner.

### Requirement: No per-turn spam
On `UserPromptSubmit`, the advisor SHALL re-emit the presence banner only when the
set of who-is-editing-what has changed since the last emit; an unchanged set SHALL
produce no output. `SessionStart` SHALL always announce current live peers.

#### Scenario: Unchanged set stays quiet
- **WHEN** the live-session set is unchanged across consecutive prompts
- **THEN** only the first turn emits a presence banner.

### Requirement: Fail-open
Presence recording and reporting SHALL never block a session or an edit. Any
error (missing module, unreadable state, non-git cwd) SHALL result in no presence
output and a zero exit, leaving the existing protected-branch advisory intact.

#### Scenario: Presence is additive
- **WHEN** the presence module is absent or errors
- **THEN** the protected-branch advisory still emits and the hook exits 0.
