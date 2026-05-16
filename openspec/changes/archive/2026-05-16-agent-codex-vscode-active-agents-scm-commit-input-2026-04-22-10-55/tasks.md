## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-codex-vscode-active-agents-scm-commit-input-2026-04-22-10-55`; branch=`agent/codex/vscode-active-agents-scm-commit-input-2026-04-22-10-55`; scope=`templates/vscode/guardex-active-agents/*`, `vscode/guardex-active-agents/*`, `test/vscode-active-agents-session-state.test.js`; action=`add a selected-session SCM commit input and header affordance to the Active Agents companion`.
- Copy prompt: Continue `agent-codex-vscode-active-agents-scm-commit-input-2026-04-22-10-55` on branch `agent/codex/vscode-active-agents-scm-commit-input-2026-04-22-10-55`. Work inside the existing sandbox, review `openspec/changes/agent-codex-vscode-active-agents-scm-commit-input-2026-04-22-10-55/tasks.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/codex/vscode-active-agents-scm-commit-input-2026-04-22-10-55 --base main --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-codex-vscode-active-agents-scm-commit-input-2026-04-22-10-55`.
- [x] 1.2 Define normative requirements in `specs/vscode-active-agents-scm-commit-input/spec.md`.

## 2. Implementation

- [x] 2.1 Track the currently selected Active Agents session and surface the native SCM commit box/header affordance for that selection.
- [x] 2.2 Stage and commit the selected worktree with the agent lock-file exclusion and a no-selection information message.
- [x] 2.3 Keep the source and template extension bundles in sync.

## 3. Verification

- [x] 3.1 Run `node --test test/vscode-active-agents-session-state.test.js`.
- [x] 3.2 Run `openspec validate agent-codex-vscode-active-agents-scm-commit-input-2026-04-22-10-55 --type change --strict`.
- [x] 3.3 Run `openspec validate --specs`.

## 4. Cleanup (mandatory; run before claiming completion)

- [x] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/codex/vscode-active-agents-scm-commit-input-2026-04-22-10-55 --base main --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
