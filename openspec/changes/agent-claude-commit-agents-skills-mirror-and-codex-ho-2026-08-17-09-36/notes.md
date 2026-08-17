# agent-claude-commit-agents-skills-mirror-and-codex-ho-2026-08-17-09-36 (minimal / T1)

Branch: `agent/claude/commit-agents-skills-mirror-and-codex-ho-2026-08-17-09-36`

Lands work that was already staged but stranded on the protected `main` checkout:

- `.agents/skills/**` (43 `SKILL.md`) — portable `.agents/` mirror of the skills already
  carried in `.claude/skills/` and `.codex/skills/`. Real files, matching the mirrors
  already in the repo (both are real files too, not symlinks). `scripts/check-script-symlinks.sh`
  governs only `scripts/` ↔ `templates/scripts/`, so no symlink requirement applies here.
- `.codex/hooks.json`, `.codex/hooks/HOOKS.md`, `.codex/hooks/_session_presence.py`,
  `.codex/hooks/agent_branch_advisor.py` — new Codex hook wiring (session presence tracking
  + agent-branch advisory). This is the only net-new behavior in the change.

Additive only: no existing tracked file is modified, no `src/` or CLI surface touched.

## Verification

- `npm run lint`
- `npm test`
- `node --check bin/multiagent-safety.js`
- `bash scripts/check-script-symlinks.sh`

Baseline note: this repo's `test (node 20)` job is already red on `main`. The gate for this
change is *no new failures vs base*, not absolute green.

## Handoff

- Handoff: change=`agent-claude-commit-agents-skills-mirror-and-codex-ho-2026-08-17-09-36`; branch=`agent/claude/commit-agents-skills-mirror-and-codex-ho-2026-08-17-09-36`; scope=`.agents/skills/** + .codex/hooks/**`; action=`finish via PR into main`.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/commit-agents-skills-mirror-and-codex-ho-2026-08-17-09-36 --base main --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
