## Why

`gx branch start` could silently hand a second agent a stale worktree whose branch had already been merged and cleaned. The dirty-worktree-reuse heuristic only filtered on `agent/<slug>/` prefix, dirty state, and token-match — it never asked "has this branch already landed?". In a recent 12-lane parallel dispatch, agent B's `gx branch start` matched the still-on-disk worktree of agent A (whose PR had merged minutes earlier), pointing the new task at agent A's merged HEAD. The mismatch was visible on first edit, so it was caught manually, but the same race in an autonomous fleet would have produced a PR-time conflict instead of a clean lane.

## What Changes

- Add a `branch_published_then_remote_pruned` filter inside `find_matching_dirty_agent_worktree` (`templates/scripts/agent-branch-start.sh`). A candidate worktree is skipped when its branch's upstream config is set (so the branch was pushed at some point) but the matching `refs/remotes/<remote>/<branch>` ref no longer exists locally (so `gx branch finish ... --cleanup` already pruned the remote).
- That combination only arises after a finish that successfully published, merged, and pruned the branch — a freshly-created agent branch never has an upstream until `push -u`, so the "started, dirty, no commits yet" reuse case keeps working unchanged.
- Emit a clear stderr line (`Skipping merged-and-cleaned worktree: …`) so operators see why a stale lane was bypassed.
- Add a regression test (`test/branch.test.js`) that simulates the post-cleanup state (upstream config + missing remote-tracking ref + dirty file) and asserts a fresh lane is created instead of the merged one being reused.

## Impact

- Affected surfaces: `gx branch start` worktree-reuse heuristic only. Finish flow, prune flow, and lock-claim flow are untouched.
- Risk: low. The filter is gated on both a config key (`branch.<branch>.remote`) AND the absence of `refs/remotes/<remote>/<branch>`. The existing "fresh agent, dirty, no commits yet" reuse test (`branch.test.js`) continues to pass because that scenario never sets `branch.<branch>.remote`.
- Rollout: no flag; once shipped, every `gx branch start` call benefits. Operator-visible change is the new "Skipping merged-and-cleaned worktree" stderr line in the case it triggers; otherwise output is unchanged.
- No version bump required (bug fix in shell logic; no CLI surface change, no schema/API change).
