## Why

`gx mcp list_agents` correlated each lane to its PR with one `gh pr list --head
<branch>` call PER branch. Across a large fleet that is dozens of sequential gh
calls, risking the MCP client timeout — so PR lookup was made opt-in (off by
default), which hid the headline "which PR is each agent shipping" data.

## What Changes

- New `pr.listOpenPrsForRepo(repoRoot)`: one `gh pr list --state open` call
  returning all open PRs for a repo (best-effort, never throws).
- `collect.js` correlates lanes to PRs from that single per-repo result
  (`indexPrsByBranch`), and only calls gh for repos that actually have ≥1 agent
  lane (most repos have none → zero gh calls).
- `list_agents` PR lookup is **on by default** again (cheap now); pass
  `include_prs:false` to skip gh entirely.

## Impact

- **Affected**: `src/pr.js` (new `listOpenPrsForRepo` export), `src/mcp/collect.js`
  (batch correlation), `src/mcp/server.js` (default flip + descriptions).
- **Perf**: gh calls drop from O(lanes) to O(repos-with-lanes). On a 50-repo /
  89-lane fleet, `list_agents` with PRs runs in ~19s instead of timing out.
- **Behavior**: PR data returns by default again; `my_context` still uses the
  single-branch lookup. Read-only; no repo mutation.
- Verified by `test/mcp-collect.test.js` (`indexPrsByBranch`) + live run.
