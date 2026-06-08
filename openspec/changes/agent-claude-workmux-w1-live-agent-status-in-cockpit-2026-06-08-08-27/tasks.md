## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-claude-workmux-w1-live-agent-status-in-cockpit-2026-06-08-08-27`; branch=`agent/claude/workmux-w1-live-agent-status-in-cockpit-2026-06-08-08-27`; scope=`gx agents set-status + jump + backend setWindowStatus`; action=`continue this sandbox or finish cleanup after a usage-limit/manual takeover`.
- Copy prompt: Continue `agent-claude-workmux-w1-live-agent-status-in-cockpit-2026-06-08-08-27` on branch `agent/claude/workmux-w1-live-agent-status-in-cockpit-2026-06-08-08-27`. Work inside the existing sandbox, review `openspec/changes/agent-claude-workmux-w1-live-agent-status-in-cockpit-2026-06-08-08-27/tasks.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/claude/workmux-w1-live-agent-status-in-cockpit-2026-06-08-08-27 --base main --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-claude-workmux-w1-live-agent-status-in-cockpit-2026-06-08-08-27`.
- [x] 1.2 Define normative requirements in `specs/workmux-w1-live-agent-status-in-cockpit-window-titles-plus-jump-to-waiting-done/spec.md`.

## 2. Implementation

- [x] 2.1 Add `src/agents/activity.js` (activity model, set-status producer, jump selection).
- [x] 2.2 Add `gx agents set-status` / `gx agents jump` dispatch + arg parsing (incl. subcommand allowlist + flag guards).
- [x] 2.3 Add non-destructive `setWindowStatus` to the tmux + kitty backends.
- [x] 2.4 Add `test/agents-activity.test.js` regression coverage (unit + parser-level).

## 3. Verification

- [x] 3.1 `node --test test/agents-activity.test.js` (26 pass); E2E smoke proves set-status persists activity + jump returns the pane target; full-suite failing set byte-identical to base (no new failures).
- [x] 3.2 Run `openspec validate agent-claude-workmux-w1-live-agent-status-in-cockpit-2026-06-08-08-27 --type change --strict` (valid).
- [x] 3.3 Run `openspec validate --specs` (133 passed).

## 4. Cleanup (mandatory; run before claiming completion)

- [ ] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/claude/workmux-w1-live-agent-status-in-cockpit-2026-06-08-08-27 --base main --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [ ] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [ ] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
