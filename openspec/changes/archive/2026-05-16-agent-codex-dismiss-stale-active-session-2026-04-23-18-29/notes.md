# agent-codex-dismiss-stale-active-session-2026-04-23-18-29 (minimal / T1)

Branch: `agent/codex/dismiss-stale-active-session-2026-04-23-18-29`

Describe the change in a sentence or two. Commit message is the spec of record.

## Handoff

- Handoff: change=`agent-codex-dismiss-stale-active-session-2026-04-23-18-29`; branch=`agent/codex/dismiss-stale-active-session-2026-04-23-18-29`; scope=`Active Agents dismiss action for stalled/dead rows, template parity, manifest bump, focused extension tests`; action=`continue this sandbox, add a separate Dismiss action that removes stale active-session records without reusing Stop, then verify and finish cleanup after the earlier usage-limit takeover`.
- Copy prompt: Continue `agent-codex-dismiss-stale-active-session-2026-04-23-18-29` on branch `agent/codex/dismiss-stale-active-session-2026-04-23-18-29`. Work inside the existing sandbox, review `openspec/changes/agent-codex-dismiss-stale-active-session-2026-04-23-18-29/notes.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/codex/dismiss-stale-active-session-2026-04-23-18-29 --base main --via-pr --wait-for-merge --cleanup`.
- Result: added a separate `Dismiss` action for `stalled`/`dead` Active Agents rows, deleting the matching `.omx/state/active-sessions/*.json` record without reusing the live `Stop` flow; verified with `node --test test/vscode-active-agents-session-state.test.js` (`54/54`).

## Cleanup

- [x] Run: `gx branch finish --branch agent/codex/dismiss-stale-active-session-2026-04-23-18-29 --base main --via-pr --wait-for-merge --cleanup`
- [x] Record PR URL + `MERGED` state in the completion handoff.
- [x] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
