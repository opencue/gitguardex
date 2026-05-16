## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-codex-codex-task-2026-05-13-00-50`; branch=`agent/codex/codex-task-2026-05-13-00-50`; scope=`gx setup creates CLAUDE.md link to AGENTS.md`; action=`continue this sandbox or finish cleanup after a usage-limit/manual takeover`.
- Copy prompt: Continue `agent-codex-codex-task-2026-05-13-00-50` on branch `agent/codex/codex-task-2026-05-13-00-50`. Work inside the existing sandbox, review `openspec/changes/agent-codex-codex-task-2026-05-13-00-50/tasks.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/codex/codex-task-2026-05-13-00-50 --base dev --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-codex-codex-task-2026-05-13-00-50`.
- [x] 1.2 Define normative requirements in `specs/codex-task/spec.md`.

## 2. Implementation

- [x] 2.1 Implement scoped behavior changes.
- [x] 2.2 Add/update focused regression coverage.

## 3. Verification

- [x] 3.1 Run targeted project verification commands.
  - `node --test --test-name-pattern "CLAUDE.md|setup provisions workflow files" test/setup.test.js` passed 2/2.
  - Full `node --test test/setup.test.js` ran the new cases successfully, but the suite still has unrelated baseline failures in hook redirect, older git `worktree --orphan`, masterplan path, disabled OpenSpec slug, and Colony package rename expectations.
- [x] 3.2 Run `openspec validate agent-codex-codex-task-2026-05-13-00-50 --type change --strict`.
- [x] 3.3 Run `openspec validate --specs`.

## 4. Cleanup (mandatory; run before claiming completion)

- [x] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
