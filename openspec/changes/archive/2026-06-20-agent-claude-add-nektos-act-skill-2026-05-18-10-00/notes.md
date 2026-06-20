# agent-claude-add-nektos-act-skill-2026-05-18-10-00 (minimal / T1)

Branch: `agent/claude/add-nektos-act-skill-2026-05-18-10-00`

## Change

Add `gx-act` skill + `/gx-act` slash command for running GitHub Actions
locally with [nektos/act](https://github.com/nektos/act) before pushing,
so PR remote runs land green on the first round-trip and can be
squash-merged immediately.

Files added:

- `skills/gx-act/SKILL.md` — top-level skill (Codex auto-loadable).
- `.claude/skills/gx-act/SKILL.md` — Claude Code skill mirror.
- `templates/codex/skills/gx-act/SKILL.md` — codex install template.
- `.claude/commands/gx-act.md` — `/gx-act` slash command source.

Files modified:

- `src/cli/commands/claude.js` — `MANAGED_SLASH_COMMANDS` now includes
  `gx-act.md` so `gx claude install` propagates `/gx-act` into target
  repos.
- `AGENTS.md` (and via symlink `CLAUDE.md`) — quickstart mentions
  `/gx-act` and the local-CI-then-squash-merge flow.

## Verification

- `node --test test/claude-install.test.js` — 12 pass, 0 fail.
- Full `npm test` shows 23 unrelated pre-existing failures (same on
  bare `main` at b8ec4ff); none touch slash-command or skill installs.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/add-nektos-act-skill-2026-05-18-10-00 --base main --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
