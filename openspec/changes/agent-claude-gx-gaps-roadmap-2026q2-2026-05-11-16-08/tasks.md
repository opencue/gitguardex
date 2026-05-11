## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-claude-gx-gaps-roadmap-2026q2-2026-05-11-16-08`; branch=`agent/claude/gx-gaps-roadmap-2026q2-2026-05-11-16-08`; scope=`docs-only roadmap of 7 gap analyses for future gx changes`; action=`continue this sandbox or finish cleanup after a usage-limit/manual takeover`.
- Copy prompt: Continue `agent-claude-gx-gaps-roadmap-2026q2-2026-05-11-16-08` on branch `agent/claude/gx-gaps-roadmap-2026q2-2026-05-11-16-08`. Work inside the existing sandbox, review `openspec/changes/agent-claude-gx-gaps-roadmap-2026q2-2026-05-11-16-08/tasks.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/claude/gx-gaps-roadmap-2026q2-2026-05-11-16-08 --base main --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-claude-gx-gaps-roadmap-2026q2-2026-05-11-16-08` (proposal.md rewritten as docs-only roadmap shipping `roadmap.md` + `gaps/01..07.md`).
- [x] 1.2 Define normative requirements in `specs/gx-gaps-roadmap-2026q2/spec.md` (7 named gap documents required; consistent template; no source code touched).

## 2. Implementation

- [x] 2.1 Write `roadmap.md` index with priority-sorted table covering all 7 gaps.
- [x] 2.2 Write `gaps/01-interactive-recovery.md` (recovery verb wrapping autofinish-watch primitives).
- [x] 2.3 Write `gaps/02-structured-observability.md` (events log + flat `gx agents --json` surface).
- [x] 2.4 Write `gaps/03-stranded-lane-inventory.md` (`--stranded` filter on agents listing).
- [x] 2.5 Write `gaps/04-conflict-resolution-verb.md` (`gx resolve` for submodule/lockfile/generated-file collisions).
- [x] 2.6 Write `gaps/05-cross-process-lock-enforcement.md` (editor-layer enforcement beyond pre-commit).
- [x] 2.7 Write `gaps/06-per-remote-trust-policy.md` (per-remote allowlist for finish/push approval policy).
- [x] 2.8 Write `gaps/07-main-js-refactor.md` (split 125K `src/cli/main.js` into subcommand registry).
- [x] 2.9 No source-code edits in this change (deliberate; docs-only).

## 3. Verification

- [x] 3.1 Run targeted project verification: `openspec validate agent-claude-gx-gaps-roadmap-2026q2-2026-05-11-16-08 --type change --strict` — passed ("Change ... is valid").
- [x] 3.2 Run `openspec validate --specs` — passed ("No items found to validate" since no main-spec deltas).
- [x] 3.3 Confirm `git status` inside the worktree only shows files under `openspec/changes/agent-claude-gx-gaps-roadmap-2026q2-2026-05-11-16-08/` — confirmed, 12 files all rooted there.

## 4. Cleanup (mandatory; run before claiming completion)

- [ ] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/claude/gx-gaps-roadmap-2026q2-2026-05-11-16-08 --base main --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [ ] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [ ] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
