# agent-codex-release-7-0-26-2026-04-23-16-21 (minimal / T1)

Branch: `agent/codex/release-7-0-26-2026-04-23-16-21`

Release-only lane: bump `@imdeadpool/guardex` to `7.0.26`, add the matching `README.md` release note entry, merge, and cut the GitHub release so publish automation can retry from a fresh semver after `v7.0.25` reached GitHub while npm still reported `7.0.24`.

## Handoff

- Handoff: change=`agent-codex-release-7-0-26-2026-04-23-16-21`; branch=`agent/codex/release-7-0-26-2026-04-23-16-21`; scope=`package.json, package-lock.json, README.md release notes`; action=`continue this sandbox, verify release-only metadata changes, then finish cleanup and cut GitHub release v7.0.26`.
- Copy prompt: Continue `agent-codex-release-7-0-26-2026-04-23-16-21` on branch `agent/codex/release-7-0-26-2026-04-23-16-21`. Work inside the existing sandbox, review `openspec/changes/agent-codex-release-7-0-26-2026-04-23-16-21/notes.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/codex/release-7-0-26-2026-04-23-16-21 --base main --via-pr --wait-for-merge --cleanup`.

## Cleanup

- [x] Run: `gx branch finish --branch agent/codex/release-7-0-26-2026-04-23-16-21 --base main --via-pr --wait-for-merge --cleanup`
- [x] Record PR URL + `MERGED` state in the completion handoff.
- [x] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
