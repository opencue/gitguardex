## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-claude-add-jsdoc-to-load-bearing-modules-2026-05-17-00-33`; branch=`agent/claude/add-jsdoc-to-load-bearing-modules-2026-05-17-00-33`; scope=`Annotate src/git/index.js + src/finish/index.js with @ts-check and JSDoc (docs-only)`; action=`finish via PR + cleanup`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-claude-add-jsdoc-to-load-bearing-modules-2026-05-17-00-33`.
- [x] 1.2 Define normative requirements in `specs/add-jsdoc-to-load-bearing-modules/spec.md`.

## 2. Implementation

- [x] 2.1 Add `// @ts-check` and JSDoc to every exported function in `src/git/index.js`.
- [x] 2.2 Add `// @ts-check` and JSDoc to every exported function in `src/finish/index.js`.
- [x] 2.3 Declare shared object shapes as `@typedef` (`SpawnResult`, `RunOptions`, `SetupOperation`, `LockRegistryStatus`, `AheadBehindCounts`, `EnsureRepoBranchResult`, `AgentWorktreeEntry`, `FinishOptions`, `AutoCommitResult`).

## 3. Verification

- [x] 3.1 `node --check` passes on both files.
- [x] 3.2 `tsc --noEmit --allowJs --checkJs` reports 0 errors for both files.
- [x] 3.3 `npm test` baseline failures (23 environment-dependent tests) are unchanged before and after the change.

## 4. Cleanup (mandatory; run before claiming completion)

- [ ] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/claude/add-jsdoc-to-load-bearing-modules-2026-05-17-00-33 --base main --via-pr --wait-for-merge --cleanup`.
- [ ] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [ ] 4.3 Confirm the sandbox worktree is gone.
