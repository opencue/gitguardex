## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-codex-active-agents-selected-scm-nested-start-2026-05-11-15-59`; branch=`agent/codex/active-agents-selected-scm-nested-start-2026-05-11-15-59`; scope=`VS Code Active Agents Start Agent nested SCM targeting`; action=`finish cleanup after verification if resumed`.
- Copy prompt: Continue `agent-codex-active-agents-selected-scm-nested-start-2026-05-11-15-59` on branch `agent/codex/active-agents-selected-scm-nested-start-2026-05-11-15-59`. Work inside the existing sandbox, review this tasks file, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/codex/active-agents-selected-scm-nested-start-2026-05-11-15-59 --base main --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-codex-active-agents-selected-scm-nested-start-2026-05-11-15-59`.
- [x] 1.2 Define normative requirements in `specs/active-agents-selected-scm-nested-start/spec.md`.

## 2. Implementation

- [x] 2.1 Implement scoped behavior changes.
- [x] 2.2 Add/update focused regression coverage.

## 3. Verification

- [x] 3.1 Run targeted project verification commands.
  - `node --test test/vscode-active-agents-session-state.test.js` -> pass, 61/61.
  - `node --check vscode/guardex-active-agents/extension.js && node --check templates/vscode/guardex-active-agents/extension.js && diff -u vscode/guardex-active-agents/extension.js templates/vscode/guardex-active-agents/extension.js` -> pass.
- [x] 3.2 Run `openspec validate agent-codex-active-agents-selected-scm-nested-start-2026-05-11-15-59 --type change --strict` -> valid.
- [x] 3.3 Run `openspec validate --specs` -> no items found to validate.

## 4. Cleanup (mandatory; run before claiming completion)

- [x] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/codex/active-agents-selected-scm-nested-start-2026-05-11-15-59 --base main --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
