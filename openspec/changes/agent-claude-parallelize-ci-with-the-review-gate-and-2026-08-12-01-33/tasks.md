## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-claude-parallelize-ci-with-the-review-gate-and-2026-08-12-01-33`; branch=`agent/claude/parallelize-ci-with-the-review-gate-and-2026-08-12-01-33`; scope=`review-gate CI overlap + review model/bin knobs`; action=`continue this sandbox or finish cleanup after a usage-limit/manual takeover`.
- Copy prompt: Continue `agent-claude-parallelize-ci-with-the-review-gate-and-2026-08-12-01-33` on branch `agent/claude/parallelize-ci-with-the-review-gate-and-2026-08-12-01-33`. Work inside the existing sandbox, review `openspec/changes/agent-claude-parallelize-ci-with-the-review-gate-and-2026-08-12-01-33/tasks.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/claude/parallelize-ci-with-the-review-gate-and-2026-08-12-01-33 --base main --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-claude-parallelize-ci-with-the-review-gate-and-2026-08-12-01-33`.
- [x] 1.2 Define normative requirements in `specs/parallelize-ci-with-the-review-gate-and-add-review-model-bin-knobs/spec.md`.

## 2. Implementation

- [x] 2.1 Implement scoped behavior changes (serial-review default with draft re-hold, `--no-gate-serial-ci` parallel opt-in, `expectHeadSha` pin, `--review-model`, provider-bin env knobs, automatic Cue-shim bypass, Claude `--safe-mode`, `--review-timeout-ms`, canonical GitHub API routes for moved remotes, one retry for malformed provider JSON).
- [x] 2.2 Add/update focused regression coverage (`test/review-gate.test.js`, `test/pr-review.test.js`, `test/provider-binary.test.js`, Claude safe-mode expectations, review timeout routing tests, canonical GitHub API route tests, draft-barrier tests, malformed provider output retry).

## 3. Verification

- [x] 3.1 Run targeted project verification commands (`node --test test/github-api.test.js test/provider-binary.test.js test/pr-review-timeout.test.js test/pr-review.test.js test/review-fix.test.js test/branch-gate-review.test.js test/review-gate.test.js test/gate-baseline.test.js test/gate-carry-forward.test.js`: 130 pass, 0 fail; `npx --yes --package @biomejs/biome@1.9.4 biome lint <touched files>` clean; `node -c <touched files>` clean).
- [x] 3.2 Run `openspec validate agent-claude-parallelize-ci-with-the-review-gate-and-2026-08-12-01-33 --type change --strict`.
- [x] 3.3 Run `openspec validate --specs` (133 passed, 0 failed).

## 4. Cleanup (mandatory; run before claiming completion)

- [ ] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/claude/parallelize-ci-with-the-review-gate-and-2026-08-12-01-33 --base main --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [ ] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [ ] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
