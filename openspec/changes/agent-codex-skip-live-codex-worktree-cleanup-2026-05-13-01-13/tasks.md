## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-codex-skip-live-codex-worktree-cleanup-2026-05-13-01-13`; branch=`agent/<your-name>/<branch-slug>`; scope=`TODO`; action=`continue this sandbox or finish cleanup after a usage-limit/manual takeover`.
- Copy prompt: Continue `agent-codex-skip-live-codex-worktree-cleanup-2026-05-13-01-13` on branch `agent/<your-name>/<branch-slug>`. Work inside the existing sandbox, review `openspec/changes/agent-codex-skip-live-codex-worktree-cleanup-2026-05-13-01-13/tasks.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-codex-skip-live-codex-worktree-cleanup-2026-05-13-01-13`.
- [x] 1.2 Define normative requirements in `specs/skip-live-codex-worktree-cleanup/spec.md`.

## 2. Implementation

- [x] 2.1 Implement scoped behavior changes (`has_live_process_in_worktree` + `process_entry` precondition in `templates/scripts/agent-worktree-prune.sh`).
- [x] 2.2 Add/update focused regression coverage (`test/doctor.test.js` — "preserves detached agent worktrees with live processes").

## 3. Verification

- [x] 3.1 Run targeted project verification commands. Evidence: `node --test --test-name-pattern="preserves detached agent worktrees with live processes" test/doctor.test.js` → 1 passed; sibling tests ("auto-prunes detached-HEAD agent worktrees", "preserves stranded worktrees when GUARDEX_SKIP_AUTO_WORKTREE_PRUNE=1") also pass (3/3).
- [x] 3.2 Run `openspec validate agent-codex-skip-live-codex-worktree-cleanup-2026-05-13-01-13 --type change --strict`. Evidence: "Change ... is valid".
- [x] 3.3 Run `openspec validate --specs`. Evidence: "No items found to validate" (no main spec deltas in this change).

## 4. Cleanup (mandatory; run before claiming completion)

- [ ] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/codex/skip-live-codex-worktree-cleanup-2026-05-13-01-13 --base main --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [ ] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [ ] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
