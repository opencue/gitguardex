## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

Handoff: 2026-04-22 09:05Z codex owns `templates/vscode/guardex-active-agents/*`, `test/vscode-active-agents-session-state.test.js`, `README.md`, and this change workspace to make actively working Guardex lanes easier to spot in VS Code.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-codex-vscode-working-agents-groups-2026-04-22-09-05`.
- [x] 1.2 Define normative requirements in `specs/vscode-working-agents-groups/spec.md`.

## 2. Implementation

- [x] 2.1 Expand session activity derivation to `blocked`, `working`, `idle`, `stalled`, and `dead`, using git markers, dirty worktree status, PID liveness, and worktree mtimes.
- [x] 2.2 Group `ACTIVE AGENTS` into visible `BLOCKED`, `WORKING NOW`, `IDLE`, `STALLED`, and `DEAD` sections, with distinct ThemeIcons/tooltips and updated repo/badge summaries.
- [x] 2.3 Update README guidance and focused regression tests for the expanded session-state behavior.

## 3. Verification

- [x] 3.1 Run `node --test test/vscode-active-agents-session-state.test.js`.
- [x] 3.2 Run `openspec validate agent-codex-vscode-working-agents-groups-2026-04-22-09-05 --type change --strict`.
- [x] 3.3 Run `openspec validate --specs`.

## 4. Cleanup

- [x] 4.1 Run the cleanup pipeline: `bash scripts/agent-branch-finish.sh --branch agent/codex/vscode-working-agents-groups-2026-04-22-09-05 --base main --via-pr --wait-for-merge --cleanup`.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).

BLOCKED: This sandbox picked up unrelated concurrent edits in `scripts/agent-branch-finish.sh`, `scripts/agent-branch-start.sh`, `scripts/codex-agent.sh`, plus a new untracked `openspec/changes/agent-codex-nest-active-agent-changes-2026-04-22-10-53/` workspace after the session-state patch was verified. Do not run finish/cleanup until the branch owner decides whether to keep or split those additional changes.
