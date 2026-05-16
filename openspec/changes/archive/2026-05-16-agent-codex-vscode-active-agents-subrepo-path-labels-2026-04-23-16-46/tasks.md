## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-codex-vscode-active-agents-subrepo-path-labels-2026-04-23-16-46`; branch=`agent/codex/vscode-active-agents-subrepo-path-labels-2026-04-23-16-46`; scope=`VS Code Active Agents top-level repo labels for nested git repos and single-subproject session lanes, template parity, manifest bump, focused regression`; action=`show slash-delimited workspace/subrepo labels like recodee/gitguardex, verify, then finish via PR merge cleanup`.
- Copy prompt: Continue `agent-codex-vscode-active-agents-subrepo-path-labels-2026-04-23-16-46` on branch `agent/codex/vscode-active-agents-subrepo-path-labels-2026-04-23-16-46`. Work inside the existing sandbox, review `openspec/changes/agent-codex-vscode-active-agents-subrepo-path-labels-2026-04-23-16-46/tasks.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/codex/vscode-active-agents-subrepo-path-labels-2026-04-23-16-46 --base main --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-codex-vscode-active-agents-subrepo-path-labels-2026-04-23-16-46`.
- [x] 1.2 Define normative requirements in `specs/vscode-active-agents-extension/spec.md`.

## 2. Implementation

- [x] 2.1 Render top-level repo labels as slash-delimited workspace-relative paths.
- [x] 2.2 Promote a shared nested `projectPath` onto the repo row when all visible sessions in that repo target the same subproject.
- [x] 2.3 Mirror extension changes in `templates/vscode/guardex-active-agents/extension.js` and bump live/template manifests.
- [x] 2.4 Add/update focused regression coverage.

## 3. Verification

- [x] 3.1 Run `node --test test/vscode-active-agents-session-state.test.js`.
- [x] 3.2 Run `openspec validate agent-codex-vscode-active-agents-subrepo-path-labels-2026-04-23-16-46 --type change --strict`.
- [x] 3.3 Run `openspec validate --specs`.
- [x] 3.4 Run `npm test`.

## 4. Cleanup (mandatory; run before claiming completion)

- [x] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/codex/vscode-active-agents-subrepo-path-labels-2026-04-23-16-46 --base main --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
