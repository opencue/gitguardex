## Why

Multiple agents (Claude, Codex) run in parallel across repos and step on each
other: they don't know who is on which branch, which PR is in flight, or who
already claimed a file. Two concrete failure modes: an agent edits the PRIMARY
checkout (not an isolated worktree) and a later branch switch auto-stashes the
work; and two agents edit the same file because lock ownership isn't visible
across worktrees. gitguardex already KNOWS all of this (worktrees, branches,
locks, PRs) but only exposes it to a human via `gx cockpit`. Agents need it
programmatically.

## What Changes

- New `gx mcp` command with a hand-rolled, dependency-free stdio JSON-RPC MCP
  server (no `@modelcontextprotocol/sdk` — keeps gx at 2 deps).
- Four READ-ONLY tools, derived automatically from git/worktree/lock/PR state
  (no manual bookkeeping; complements, not replaces, Colony):
  - `list_agents` — every active agent lane across all discovered repos:
    repo, branch, worktree, task, the PR it's shipping, held locks, last
    commit, and a warning when a lane is editing the primary checkout.
  - `repo_state(repo)` — the same for a single repo.
  - `who_owns(file)` — which agent/branch holds the lock on a path, aggregated
    across ALL worktrees (lock files are per-worktree on disk), for a real
    cross-agent collision check before editing.
  - `my_context` — the current session's repo, branch, worktree, whether it's
    the protected primary checkout, held locks, and PR.
- `gx mcp list-agents` / `who-owns` CLI views (human/debug) and `gx mcp register`
  (prints the `claude mcp add` one-liner + `.mcp.json` snippet).

## Impact

- **New surfaces**: `src/mcp/collect.js`, `src/mcp/server.js`,
  `src/cli/commands/mcp.js`; one dispatch line in `src/cli/main.js`. No new
  dependency. No changes to any guard or mutating path.
- **Read-only**: the server never writes to a repo. PR lookups are best-effort
  (skip un-pushed branches; gh missing/unauthed → null, never throws).
- **Registration is opt-in**: the server isn't wired into any harness
  automatically; users run `claude mcp add gx -s user -- gx mcp serve`.
- **Does not by itself prevent collisions** — it gives the visibility + a
  `who_owns` pre-check. The primary-checkout-edit root cause still needs the
  separate worktree-discipline work; the `warning` field surfaces it.
- Verified by `test/mcp-collect.test.js` and `test/mcp-server.test.js`.
