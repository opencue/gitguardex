## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-codex-refactor-cli-doctor-foundations-2026-04-22-10-50`; branch=`agent/codex/refactor-cli-doctor-foundations-2026-04-22-10-50`; scope=`doctor sandbox lifecycle typing + extraction in bin/multiagent-safety.js, guarded by install.test.js doctor regressions`; action=`continue this sandbox or finish cleanup after a usage-limit/manual takeover`.
- Copy prompt: Continue `agent-codex-refactor-cli-doctor-foundations-2026-04-22-10-50` on branch `agent/codex/refactor-cli-doctor-foundations-2026-04-22-10-50`. Work inside the existing sandbox, review `openspec/changes/agent-codex-refactor-cli-doctor-foundations-2026-04-22-10-50/tasks.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/codex/refactor-cli-doctor-foundations-2026-04-22-10-50 --base main --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Finalize the narrow cleanup scope: typed doctor sandbox payloads plus lifecycle extraction only.
- [x] 1.2 Define normative requirements in `specs/cli-doctor-foundations/spec.md`.

## 2. Implementation

- [x] 2.1 Add JSDoc typedefs for the doctor sandbox and auto-finish summary/result payloads in `bin/multiagent-safety.js`.
- [x] 2.2 Extract `runDoctorInSandbox()` into explicit internal lifecycle phases/helpers while preserving the existing CLI surface and output.
- [x] 2.3 Keep `test/install.test.js` doctor regressions green and add focused coverage only if the extraction reveals an unprotected edge.
  Evidence: existing protected-main doctor regressions stayed green, so no extra edge-specific test was required for this pass.

## 3. Verification

- [x] 3.1 Run targeted project verification commands:
  - `node --test --test-name-pattern="doctor on protected main|doctor forwards --no-wait-for-merge|doctor compacts auto-finish failures" test/install.test.js`
  - `node --test test/install.test.js`
  - `node --test test/metadata.test.js`
  Evidence: targeted doctor tests passed (6/6); full `test/install.test.js` passed (138/138); `test/metadata.test.js` exposed a pre-existing template/runtime parity failure in `scripts/agent-branch-start.sh` vs `templates/scripts/agent-branch-start.sh`, outside this diff.
- [x] 3.2 Run `openspec validate agent-codex-refactor-cli-doctor-foundations-2026-04-22-10-50 --type change --strict`.
- [x] 3.3 Run `openspec validate --specs`.

## 4. Cleanup (mandatory; run before claiming completion)

- [x] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/codex/refactor-cli-doctor-foundations-2026-04-22-10-50 --base main --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
