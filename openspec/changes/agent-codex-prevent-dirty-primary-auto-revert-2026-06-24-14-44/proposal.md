## Why

- The primary-checkout post-checkout guard can currently auto-stash dirty work
  as `guardex-auto-revert` and switch the visible checkout back to the protected
  branch. In shared agent workflows that can move another agent's or the user's
  uncommitted edits out from under them.

## What Changes

- Keep clean-primary auto-revert behavior for accidental branch switches during
  agent sessions.
- For dirty primary checkouts, print the existing guard warning plus a manual
  recovery hint, but do not run `git stash` and do not switch branches again.
- Update the agent-facing warning text and regression coverage for the dirty
  primary checkout path.

## Impact

- Affected surfaces: `gx hook run post-checkout`, installed hook shims that
  dispatch to it, MCP primary-checkout warnings, and the full AGENTS contract
  template.
- Risk: a dirty primary checkout remains on the newly selected branch until the
  user/agent recovers manually. This is intentional because preserving
  uncommitted work is safer than moving it automatically.
