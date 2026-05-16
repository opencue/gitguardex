## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-claude-skip-merged-worktree-on-reuse-2026-05-16-00-37`; branch=`agent/<your-name>/<branch-slug>`; scope=`TODO`; action=`continue this sandbox or finish cleanup after a usage-limit/manual takeover`.
- Copy prompt: Continue `agent-claude-skip-merged-worktree-on-reuse-2026-05-16-00-37` on branch `agent/<your-name>/<branch-slug>`. Work inside the existing sandbox, review `openspec/changes/agent-claude-skip-merged-worktree-on-reuse-2026-05-16-00-37/tasks.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [ ] 1.1 Finalize proposal scope and acceptance criteria for `agent-claude-skip-merged-worktree-on-reuse-2026-05-16-00-37`.
- [ ] 1.2 Define normative requirements in `specs/skip-merged-worktree-on-reuse/spec.md`.

## 2. Implementation

- [ ] 2.1 Implement scoped behavior changes.
- [ ] 2.2 Add/update focused regression coverage.

## 3. Verification

- [ ] 3.1 Run targeted project verification commands.
- [ ] 3.2 Run `openspec validate agent-claude-skip-merged-worktree-on-reuse-2026-05-16-00-37 --type change --strict`.
- [ ] 3.3 Run `openspec validate --specs`.

## 4. Cleanup (mandatory; run before claiming completion)

- [x] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
