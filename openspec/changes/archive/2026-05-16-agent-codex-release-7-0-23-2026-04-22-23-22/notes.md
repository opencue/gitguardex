# agent-codex-release-7-0-23-2026-04-22-23-22 (minimal / T1)

Branch: `agent/codex/release-7-0-23-2026-04-22-23-22`

Bump `@imdeadpool/guardex` from `7.0.22` to `7.0.23`, add the matching `README.md` release notes entry, and cut the corresponding GitHub release so the published package version and GitHub release history move back in sync.

Scope:
- Update `package.json` and `package-lock.json` to `7.0.23`.
- Add `README.md -> Release notes -> v7.0.23`.
- Finish through PR merge, then run `gx release` from `main` and verify GitHub release plus npm registry version.

Verification:
- `node -p "require('./package.json').version"`
- `node -p "require('./package-lock.json').version"`
- `gx release`
- `gh release view v7.0.23 --repo recodeee/gitguardex`
- `npm view @imdeadpool/guardex version dist-tags --json`

## Handoff

- Handoff: change=`agent-codex-release-7-0-23-2026-04-22-23-22`; branch=`agent/codex/release-7-0-23-2026-04-22-23-22`; scope=`package.json, package-lock.json, README.md, openspec/changes/agent-codex-release-7-0-23-2026-04-22-23-22/*`; action=`finish this sandbox via PR merge + cleanup, then create GitHub release v7.0.23 from main and verify npm registry truth`.
- Copy prompt: Continue `agent-codex-release-7-0-23-2026-04-22-23-22` on branch `agent/codex/release-7-0-23-2026-04-22-23-22`. Work inside the existing sandbox, review `openspec/changes/agent-codex-release-7-0-23-2026-04-22-23-22/notes.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/codex/release-7-0-23-2026-04-22-23-22 --base main --via-pr --wait-for-merge --cleanup`.

## Cleanup

- [x] Run: `gx branch finish --branch agent/codex/release-7-0-23-2026-04-22-23-22 --base main --via-pr --wait-for-merge --cleanup`
- [x] Run: `gx release`
- [x] Record PR URL + `MERGED` state and release URL in the completion handoff.
- [x] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
