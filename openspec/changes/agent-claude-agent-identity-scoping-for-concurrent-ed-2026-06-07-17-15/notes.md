# agent-claude-agent-identity-scoping-for-concurrent-ed-2026-06-07-17-15 (minimal / T1)

Branch: `agent/<your-name>/<branch-slug>`

Describe the change in a sentence or two. Commit message is the spec of record.

## Handoff

- Handoff: change=`agent-claude-agent-identity-scoping-for-concurrent-ed-2026-06-07-17-15`; branch=`agent/<your-name>/<branch-slug>`; scope=`TODO`; action=`continue this sandbox or finish cleanup after a usage-limit/manual takeover`.
- Copy prompt: Continue `agent-claude-agent-identity-scoping-for-concurrent-ed-2026-06-07-17-15` on branch `agent/<your-name>/<branch-slug>`. Work inside the existing sandbox, review `openspec/changes/agent-claude-agent-identity-scoping-for-concurrent-ed-2026-06-07-17-15/notes.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).

## Follow-up goal (user-requested 2026-06-07)
- G-guard: skill_guard.py PreToolUse blocks edits whenever the SESSION cwd is a protected branch, even when the target file lives in an agent worktree on an agent branch. Resolve edit-permission from the target file_path branch (its own worktree), not just CLAUDE_PROJECT_DIR. Check: a Write/Edit to a path inside an agent worktree is allowed while the session sits on main.
