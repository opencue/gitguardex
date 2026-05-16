## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-codex-codex-session-task-mode-decider-2026-04-22-12-16`; branch=`agent/codex/codex-session-task-mode-decider-2026-04-22-12-16`; scope=`scripts/agent-branch-start.sh, scripts/codex-agent.sh, scripts/agent-session-state.js, templates/scripts/agent-branch-start.sh, templates/scripts/codex-agent.sh, vscode/guardex-active-agents/session-schema.js, templates/vscode/guardex-active-agents/session-schema.js, test/branch.test.js, test/sandbox.test.js, test/vscode-active-agents-session-state.test.js, openspec/changes/agent-codex-codex-session-task-mode-decider-2026-04-22-12-16/*`; action=`finish the tier-aware branch-start and task-routing lane, verify the focused coverage, then run the mandatory PR merge + cleanup flow`.
- Copy prompt: Continue `agent-codex-codex-session-task-mode-decider-2026-04-22-12-16` on branch `agent/codex/codex-session-task-mode-decider-2026-04-22-12-16`. Work inside the existing sandbox, review `openspec/changes/agent-codex-codex-session-task-mode-decider-2026-04-22-12-16/tasks.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/codex/codex-session-task-mode-decider-2026-04-22-12-16 --base main --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-codex-codex-session-task-mode-decider-2026-04-22-12-16`.
- [x] 1.2 Define normative requirements in `specs/codex-session-task-routing/spec.md`.

## 2. Implementation

- [x] 2.1 Wire real `T0/T1/T2/T3` behavior into `scripts/agent-branch-start.sh` and `templates/scripts/agent-branch-start.sh`.
- [x] 2.2 Add a Codex-side task-mode decider in `scripts/codex-agent.sh` and `templates/scripts/codex-agent.sh` so simple asks route to caveman/T1 and broader asks route to OMX/T2-or-T3.
- [x] 2.3 Persist the selected task mode/tier in the active-session record surface.
- [x] 2.4 Add/update focused regression coverage for branch-start tier scaffolding, codex-agent routing, and session metadata.

## 3. Verification

- [x] 3.1 Run targeted project verification commands. `node --test test/branch.test.js test/sandbox.test.js test/vscode-active-agents-session-state.test.js` passed after aligning the new tiered branch-start tests with the existing `GUARDEX_OPENSPEC_AUTO_INIT=true` bootstrap path; `git diff --check` also passed cleanly.
- [x] 3.2 Run `openspec validate agent-codex-codex-session-task-mode-decider-2026-04-22-12-16 --type change --strict`. Result: `Change 'agent-codex-codex-session-task-mode-decider-2026-04-22-12-16' is valid`.
- [x] 3.3 Run `openspec validate --specs`. Result: command completed successfully and reported `No items found to validate.`

## 4. Cleanup (mandatory; run before claiming completion)

- [x] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/codex/codex-session-task-mode-decider-2026-04-22-12-16 --base main --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
