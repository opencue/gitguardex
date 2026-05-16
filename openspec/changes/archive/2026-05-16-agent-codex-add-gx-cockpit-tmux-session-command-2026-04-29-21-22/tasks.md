## Definition of Done

This change is complete only when all of the following are true:

- Every applicable checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and STOP.

Handoff: 2026-04-29 19:22Z codex owns `src/cli/main.js`, `src/cli/args.js`, `src/cockpit/index.js`, `src/tmux/session.js`, `test/cockpit-command.test.js`, and this change workspace to add the minimal `gx cockpit` tmux session command.

## 1. Specification

- [x] 1.1 Define minimal cockpit command scope and non-goals.
- [x] 1.2 Add normative CLI cockpit requirements.

## 2. Implementation

- [x] 2.1 Wire `gx cockpit` into CLI dispatch and help/suggestion metadata.
- [x] 2.2 Add cockpit argument handling for `--session`, `--attach`, and target repo resolution.
- [x] 2.3 Add tmux session helpers for availability checks, create, exists, and attach.
- [x] 2.4 Start the first control pane with `gx agents status` and no agent launch/keybinding behavior.

## 3. Verification

- [x] 3.1 Run `node --test test/cockpit-command.test.js test/tmux-command.test.js test/tmux-session.test.js test/cli-args-dispatch.test.js test/metadata.test.js`.
- [x] 3.2 Run `openspec validate --specs`.
- [x] 3.3 Run `openspec validate agent-codex-add-gx-cockpit-tmux-session-command-2026-04-29-21-22 --type change --strict`.

Verification notes:
- `node --test test/cockpit-command.test.js test/tmux-command.test.js test/tmux-session.test.js test/cli-args-dispatch.test.js test/metadata.test.js` passed 51/51 after rebasing onto current `origin/main`.
- `openspec validate --specs` returned `No items found to validate.` in this checkout.
- `openspec validate agent-codex-add-gx-cockpit-tmux-session-command-2026-04-29-21-22 --type change --strict` returned `Change 'agent-codex-add-gx-cockpit-tmux-session-command-2026-04-29-21-22' is valid`.

## 4. Cleanup

- [x] 4.1 Run `gx branch finish --branch "agent/codex/add-gx-cockpit-tmux-session-command-2026-04-29-21-22" --base main --via-pr --wait-for-merge --cleanup`.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; local/remote branch refs are cleaned up).
