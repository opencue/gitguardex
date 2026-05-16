## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-claude-add-e2e-ci-finish-flow-2026-05-17-00-35`; branch=`agent/claude/add-e2e-ci-finish-flow-2026-05-17-00-35`; scope=`add PR-time e2e CI coverage of gx branch finish --via-pr loop`; action=`open PR; merge via wait-for-merge; prune sandbox`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-claude-add-e2e-ci-finish-flow-2026-05-17-00-35`.
- [x] 1.2 Define normative requirements in `specs/add-e2e-ci-finish-flow/spec.md`.

## 2. Implementation

- [x] 2.1 Add `test/e2e/finish-via-pr.sh` driving real `bin/multiagent-safety.js` against a local-only fixture, with `gh` mock injected via `GUARDEX_GH_BIN`.
- [x] 2.2 Add `.github/workflows/e2e-finish.yml` PR-scoped (paths-filtered) + `workflow_dispatch`, Node 20, 10-min timeout, matching `ci.yml` action SHAs and draft-skip rule.

## 3. Verification

- [x] 3.1 Run `bash test/e2e/finish-via-pr.sh` locally; all 6 PASS lines printed; exit 0; verified twice in a row.
- [x] 3.2 Run `actionlint .github/workflows/*.yml`; exit 0 on all workflows.
- [x] 3.3 Smoke `node --test test/finish.test.js` (no regression beyond the pre-existing env-dependent `finish command auto-commits dirty agent worktree` test that fails identically on `main`).

## 4. Cleanup (mandatory; run before claiming completion)

- [ ] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/claude/add-e2e-ci-finish-flow-2026-05-17-00-35 --base main --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [ ] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [ ] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
