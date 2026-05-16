## Why

- The `vscode-material-icon-theme` submodule was added three weeks ago but is not used by anything in the repo — it pulls in unrelated upstream history and clutters the root listing.
- The `.agents` symlink at the repo root is a dead backward-compat bridge: it points at `.codex` and exists only so legacy paths like `.agents/hooks/skill_guard.py` keep resolving. No live tooling, hook config, or settings file references those paths anymore (the `repo hook settings reference real local hook directories` test already enforces that `.agents/hooks/...` cannot appear in any settings command).
- Carrying both surfaces costs visible structural noise at the repo root, drags four stale `.gitignore` entries for paths that no longer exist (`.agents/hooks/state/`, `.agents/.personality_migration`, `.agents/version.json`, `.agents/log/`), and forces multi-agent state-file globs in three scripts plus the agent contract to list `.agents/settings.local.json` alongside the real `.codex` / `.claude` paths.

## What Changes

- Remove the `vscode-material-icon-theme` submodule (gitlink + `.gitmodules` stanza).
- Delete the `.agents` symlink. All resolved content stays in place under `.codex` (and the per-agent variant under `.claude`).
- Drop the `.agents/hooks/skill_guard.py` entry from the skill-guard regression test — the remaining `.codex` and `.claude` copies already prove identical behavior.
- Replace `.agents/conventions/git-workflow.md` with `.codex/conventions/git-workflow.md` in the agent contract's Code Conventions table.
- Replace the single `.agents/settings.local.json` line in the Git Hygiene "Never stage or commit" list with the two real per-agent paths (`.codex/settings.local.json`, `.claude/settings.local.json`).
- Update the auto-transfer / auto-resolve / worktree-prune exclude globs in `templates/scripts/agent-branch-start.sh`, `templates/scripts/agent-branch-finish.sh`, and `templates/scripts/agent-worktree-prune.sh` the same way.
- Drop the four stale `.agents/...` entries from `.gitignore`.
- Keep the negative assertion in `test/setup.test.js` that no settings command references `/.agents/hooks/` — it is now a regression guard against re-introducing the bridge.

## Impact

- Affected surfaces: repo root layout, `.gitmodules`, `.gitignore`, `AGENTS.md` / `CLAUDE.md` (symlinked), `test/setup.test.js`, three `templates/scripts/*.sh`.
- Risk: external user-level Codex configs that hardcode `.agents/hooks/skill_guard.py` would lose the bridge. The repo's own settings files (`.codex/settings.json`, `.claude/settings.json`) already point at `.codex/hooks/...` and `.claude/hooks/...` directly, so in-repo behavior is unaffected. Any user with an older host config can simply point it at the per-agent hook path.
- No published version bump (no behavior surface for downstream `gx` consumers changes — the template glob defaults expand cleanly with the two replacement entries).
