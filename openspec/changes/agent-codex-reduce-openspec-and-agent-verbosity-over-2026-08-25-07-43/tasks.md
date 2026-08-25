## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-codex-reduce-openspec-and-agent-verbosity-over-2026-08-25-07-43`; branch=`agent/codex/reduce-openspec-and-agent-verbosity-over-2026-08-25-07-43`; scope=`direct T1, opt-in OpenSpec, minimal AGENTS refresh`; action=`verify and ship`.
- Copy prompt: Continue this existing sandbox, run the remaining verification, then finish with `gx branch finish --branch agent/codex/reduce-openspec-and-agent-verbosity-over-2026-08-25-07-43 --base main --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-codex-reduce-openspec-and-agent-verbosity-over-2026-08-25-07-43`.
- [x] 1.2 Define normative requirements in `specs/reduce-openspec-and-agent-verbosity-overhead/spec.md`.

## 2. Implementation

- [x] 2.1 Implement scoped behavior changes.
- [x] 2.2 Add/update focused regression coverage.

## 3. Verification

- [x] 3.1 Run targeted and full project verification commands.
- [x] 3.2 Run `openspec validate agent-codex-reduce-openspec-and-agent-verbosity-over-2026-08-25-07-43 --type change --strict`.
- [x] 3.3 Run `openspec validate --specs`.

## 4. Cleanup (mandatory; run before claiming completion)

- [x] 4.1 Run the queued cleanup pipeline: `gx branch finish --branch agent/codex/reduce-openspec-and-agent-verbosity-over-2026-08-25-07-43 --base main --via-pr --wait-for-merge --cleanup`.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm the sandbox worktree is gone after the finish command returns.
