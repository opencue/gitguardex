## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-claude-wire-headroom-token-saving-skills-into-g-2026-06-18-10-50`; branch=`agent/<your-name>/<branch-slug>`; scope=`TODO`; action=`continue this sandbox or finish cleanup after a usage-limit/manual takeover`.
- Copy prompt: Continue `agent-claude-wire-headroom-token-saving-skills-into-g-2026-06-18-10-50` on branch `agent/<your-name>/<branch-slug>`. Work inside the existing sandbox, review `openspec/changes/agent-claude-wire-headroom-token-saving-skills-into-g-2026-06-18-10-50/tasks.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-claude-wire-headroom-token-saving-skills-into-g-2026-06-18-10-50`.
- [x] 1.2 Define normative requirements in `specs/wire-headroom-token-saving-skills-into-gx-output/spec.md`.

## 2. Implementation

- [x] 2.1 Implement scoped behavior changes (headroom advisory part + aliases in `src/context.js`, AGENTS companion bullet, `compressBlock`/`printCompressible` in `src/output/index.js`, snippet wiring in `src/cli/commands/prompt.js`).
- [x] 2.2 Add/update focused regression coverage (`test/prompt.test.js` headroom + snippet-compression; `test/output.test.js` compressBlock unit tests).

## 3. Verification

- [x] 3.1 Run targeted project verification commands (`node --test test/output.test.js test/prompt.test.js` -> 23 pass, 0 fail; module-load sanity OK).
- [x] 3.2 Run `openspec validate agent-claude-wire-headroom-token-saving-skills-into-g-2026-06-18-10-50 --type change --strict` (valid).
- [x] 3.3 Run `openspec validate --specs` (133 passed, 0 failed).

## 4. Cleanup (mandatory; run before claiming completion)

- [ ] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [ ] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [ ] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
