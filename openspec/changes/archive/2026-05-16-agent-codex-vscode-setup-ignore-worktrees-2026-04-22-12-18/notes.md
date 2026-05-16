# agent-codex-vscode-setup-ignore-worktrees-2026-04-22-12-18 (minimal / T1)

Branch: `agent/codex/vscode-setup-ignore-worktrees-2026-04-22-12-18`

Plain `gx setup` repos should not flood VS Code Source Control with nested Guardex sandbox repos. Add a shared tracked `.vscode/settings.json` contract that tells Git to ignore `.omx/.omc` worktree scans in the default repo view, while leaving the optional parent-workspace view untouched for operators who intentionally want raw worktree repositories.

Scope:
- Teach setup/fix to create or merge `.vscode/settings.json` with shared `git.repositoryScanIgnoredFolders` entries for `.omx/agent-worktrees` and `.omc/agent-worktrees`.
- Allow repos to track `.vscode/settings.json` without unignoring the rest of `.vscode/*`.
- Add focused setup coverage for the generated settings file and JSONC merge behavior.
- Add the same tracked `.vscode/settings.json` contract to this repo so the local checkout matches the shipped behavior.

Verification:
- `node --test test/setup.test.js --test-name-pattern "setup provisions workflow files and repo config|setup appends managed gitignore block without clobbering existing entries|setup merges Guardex repo-scan ignores into tracked VS Code workspace settings"`

## Handoff

- Handoff: change=`agent-codex-vscode-setup-ignore-worktrees-2026-04-22-12-18`; branch=`agent/codex/vscode-setup-ignore-worktrees-2026-04-22-12-18`; scope=`bin/multiagent-safety.js, test/setup.test.js, test/helpers/install-test-helpers.js, .gitignore, .vscode/settings.json, openspec/changes/agent-codex-vscode-setup-ignore-worktrees-2026-04-22-12-18/*`; action=`finish this sandbox via PR merge + cleanup after targeted verification`.
- Copy prompt: Continue `agent-codex-vscode-setup-ignore-worktrees-2026-04-22-12-18` on branch `agent/codex/vscode-setup-ignore-worktrees-2026-04-22-12-18`. Work inside the existing sandbox, review `openspec/changes/agent-codex-vscode-setup-ignore-worktrees-2026-04-22-12-18/notes.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/codex/vscode-setup-ignore-worktrees-2026-04-22-12-18 --base main --via-pr --wait-for-merge --cleanup`.

## Cleanup

- [x] Run: `gx branch finish --branch agent/codex/vscode-setup-ignore-worktrees-2026-04-22-12-18 --base main --via-pr --wait-for-merge --cleanup`
- [x] Record PR URL + `MERGED` state in the completion handoff.
- [x] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
