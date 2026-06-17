# agent-codex-auto-bump-package-version-before-npm-pub-2026-06-17-10-18 (minimal / T1)

Branch: `agent/codex/auto-bump-package-version-before-npm-pub-2026-06-17-10-18`

Direct `npm publish` now checks whether the committed package version already exists on npm and bumps to the next unpublished patch version before publishing. The current release metadata is aligned to `7.1.1` because npm already contains `7.1.0`. GitHub Actions and dry runs skip the auto-bump so release artifacts remain tied to committed metadata.

## Handoff

- Handoff: change=`agent-codex-auto-bump-package-version-before-npm-pub-2026-06-17-10-18`; branch=`agent/codex/auto-bump-package-version-before-npm-pub-2026-06-17-10-18`; scope=`npm publish prepublish version bump`; action=`continue implementation or finish cleanup`.
- Copy prompt: Continue `agent-codex-auto-bump-package-version-before-npm-pub-2026-06-17-10-18` on branch `agent/codex/auto-bump-package-version-before-npm-pub-2026-06-17-10-18`. Work inside the existing sandbox, review `openspec/changes/agent-codex-auto-bump-package-version-before-npm-pub-2026-06-17-10-18/notes.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/codex/auto-bump-package-version-before-npm-pub-2026-06-17-10-18 --base main --via-pr --wait-for-merge --cleanup`.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/codex/auto-bump-package-version-before-npm-pub-2026-06-17-10-18 --base main --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
