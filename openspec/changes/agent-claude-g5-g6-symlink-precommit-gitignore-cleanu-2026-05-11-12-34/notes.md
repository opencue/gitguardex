# agent-claude-g5-g6-symlink-precommit-gitignore-cleanu-2026-05-11-12-34 (minimal / T1)

Branch: `agent/<your-name>/<branch-slug>`

Describe the change in a sentence or two. Commit message is the spec of record.

## Handoff

- Handoff: change=`agent-claude-g5-g6-symlink-precommit-gitignore-cleanu-2026-05-11-12-34`; branch=`agent/<your-name>/<branch-slug>`; scope=`TODO`; action=`continue this sandbox or finish cleanup after a usage-limit/manual takeover`.
- Copy prompt: Continue `agent-claude-g5-g6-symlink-precommit-gitignore-cleanu-2026-05-11-12-34` on branch `agent/<your-name>/<branch-slug>`. Work inside the existing sandbox, review `openspec/changes/agent-claude-g5-g6-symlink-precommit-gitignore-cleanu-2026-05-11-12-34/notes.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
