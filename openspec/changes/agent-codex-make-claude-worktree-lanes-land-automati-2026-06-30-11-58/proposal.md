## Why

- Claude Code can start Guardex agent worktrees correctly, but completed lanes can remain stranded when Claude stops without running the final `gx branch finish --via-pr --wait-for-merge --cleanup` command.
- A stranded lane keeps work off `main`, leaves the sandbox around, and can keep locks or follow-up context dangling.

## What Changes

- Add a managed Claude `Stop` hook that runs only from an `agent/*` worktree and delegates to the canonical Guardex finish flow.
- Ship the hook as a managed `templates/scripts` helper and wire it through `gx setup` and `gx claude install`.
- Keep the helper fail-open: when the finish flow cannot complete, print the retry command and keep the sandbox instead of blocking Claude shutdown.

## Impact

- Affects Claude Code integration settings, managed script scaffolding, and worktree finish recovery.
- Default behavior auto-commits dirty agent lanes through the existing finish flow; operators can set `GUARDEX_CLAUDE_STOP_FINISH=clean` or `off` to reduce or disable automation.
- The helper never runs on protected base branches or recursive Stop-hook invocations.
