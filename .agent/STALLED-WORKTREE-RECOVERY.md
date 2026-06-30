# Stalled Agent Worktree Recovery

The Guardex Codex launcher auto-finishes a branch only when the codex CLI exits cleanly inside it. If the agent is killed, crashes, runs out of budget, or is started directly via `gx branch start` without the launcher, the worktree is left dirty with no commits and no PR — a "stalled" worktree.

`scripts/agent-stalled-report.sh` is a quiet wrapper around `scripts/agent-autofinish-watch.sh --once --dry-run` that surfaces stalled worktrees. It is wired as a `SessionStart` hook in `.claude/settings.json`, so each Claude Code session begins with a one-line summary per stalled branch (and is silent when nothing is stalled).

To act on the report:

- Inspect: `bash scripts/agent-autofinish-watch.sh --once --dry-run`
- Reap merged lanes (prune worktrees whose PR already merged): `bash scripts/agent-autofinish-watch.sh --once --auto-merge`
- Run the daemon (poll forever, reaping merged lanes each cycle): `bash scripts/agent-autofinish-watch.sh --daemon --auto-merge --interval 300`

Flags: `--idle-minutes` (default 60, or `GUARDEX_AUTOFINISH_IDLE_MINUTES`) gates how long a lane must be quiet before it counts as stalled; `--interval` sets the daemon poll seconds; `--base` overrides the inferred base branch.

The watcher is deliberately conservative. It only ever **reports** agent worktrees with unmerged work (committed-no-PR or uncommitted) — it never auto-commits, pushes, or opens a PR for un-reviewed work. `--auto-merge` only reaps lanes whose PR has already **merged** (delegating to `gx worktree prune --include-pr-merged --delete-branches`), which is what fixes the post-merge "retained for now" gap. Finishing an un-PR'd lane stays a manual `gx branch finish`. Healthy in-flight lanes (open PR, or a live process in the worktree) produce no output.

A stalled lane that holds file locks can keep blocking other agents; clear those with `gx locks reap` (removes locks from worktrees idle past `--ttl-hours` / `GUARDEX_LOCK_TTL_HOURS`, default 7 days, with no live process inside).

## Source-probe temp worktree cleanup

If `gx branch finish --cleanup` reports a worktree held by a `__source-probe-*` temp path, recover with:

```bash
git worktree remove --force .omc/agent-worktrees/agent__claude__<slug>
git worktree prune
git branch -D agent/claude/<slug>
```
