## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-claude-remove-vscode-icon-submodule-and-prune-a-2026-05-16-00-27`; branch=`agent/claude/remove-vscode-icon-submodule-and-prune-a-2026-05-16-00-27`; scope=`drop vscode submodule + legacy .agents bridge + migrate state-file globs`; action=`continue in worktree or finish via gx branch finish ... --via-pr --wait-for-merge --cleanup`.
- Copy prompt: Continue `agent-claude-remove-vscode-icon-submodule-and-prune-a-2026-05-16-00-27` on branch `agent/claude/remove-vscode-icon-submodule-and-prune-a-2026-05-16-00-27`. Work inside the existing sandbox, review `openspec/changes/agent-claude-remove-vscode-icon-submodule-and-prune-a-2026-05-16-00-27/tasks.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/claude/remove-vscode-icon-submodule-and-prune-a-2026-05-16-00-27 --base main --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-claude-remove-vscode-icon-submodule-and-prune-a-2026-05-16-00-27`.
- [x] 1.2 Define normative requirements in `specs/remove-vscode-icon-submodule-and-prune-agents-dir/spec.md`.

## 2. Implementation

- [x] 2.1 Drop the `vscode-material-icon-theme` submodule (gitlink + `.gitmodules` stanza).
- [x] 2.2 Delete the `.agents` symlink and remove its four stale `.gitignore` entries.
- [x] 2.3 Migrate the agent contract's Code Conventions row from `.agents/conventions/git-workflow.md` to `.codex/conventions/git-workflow.md`.
- [x] 2.4 Replace `.agents/settings.local.json` with the live `.codex/settings.local.json` + `.claude/settings.local.json` entries in `AGENTS.md`'s "Never stage or commit" list and in the three `templates/scripts/*.sh` glob defaults.
- [x] 2.5 Drop the `.agents/hooks/skill_guard.py` import from the skill-guard regression test; keep the negative assertion that settings commands must not reference `/.agents/hooks/`.

## 3. Verification

- [ ] 3.1 Run `node --test test/setup.test.js` and confirm both the "repo hook settings reference real local hook directories" and "repo skill guard blocks shell output redirect bypasses" tests pass.
- [ ] 3.2 Run `openspec validate agent-claude-remove-vscode-icon-submodule-and-prune-a-2026-05-16-00-27 --type change --strict`.
- [ ] 3.3 Run `openspec validate --specs`.

## 4. Cleanup (mandatory; run before claiming completion)

- [x] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/claude/remove-vscode-icon-submodule-and-prune-a-2026-05-16-00-27 --base main --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
