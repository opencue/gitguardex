## Why

Two Claude Code sessions can run against the SAME worktree at once (the reported
case: one session live-editing `account.tsx` while another works the address
tab). gitguardex file locks are branch-scoped and only fire at commit time, so
neither session gets an edit-time signal that the other is in the same file —
collisions are discovered by accident.

## What Changes

- Generalize the PostToolUse edit tracker into a live-session presence registry:
  record every in-tree edit (not just `.py`) with branch, worktree, current file,
  and a `last_seen` heartbeat, in `.claude/hooks/state/session-<id>.json`.
- New shared module `_session_presence.py` (writer + reader + banner formatter +
  change-detection fingerprint).
- The SessionStart/UserPromptSubmit advisor surfaces OTHER live sessions in the
  same worktree — on ANY branch (agent worktrees too) — naming who is editing
  which file, with per-turn change-detection so it does not spam.
- Register `_session_presence.py` in `MANAGED_HOOK_FILES` so `gx claude install`
  distributes it with the hooks that import it.

## Impact

- Affected surfaces: `.claude/hooks/post_edit_tracker.py`,
  `.claude/hooks/agent_branch_advisor.py`, new `.claude/hooks/_session_presence.py`,
  `src/cli/commands/claude.js` (manifest), `test/session-presence.test.js`.
- Fail-open and additive: any error leaves the existing protected-branch advisory
  intact and exits 0; presence is never a blocker.
- Scope (MVP): same-worktree visibility (the reported case). Cross-worktree
  presence is a follow-up — sessions in different worktrees write to separate
  per-worktree state dirs.
