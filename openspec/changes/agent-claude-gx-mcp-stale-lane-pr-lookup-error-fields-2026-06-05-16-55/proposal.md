## Why

Two gaps the gx mcp review left open: (1) `list_agents` could not distinguish a
lane with no open PR from one whose `gh` lookup *failed* (both showed `pr:null`),
hiding gh-auth/offline problems; (2) there was no signal for forgotten lanes
(old, merged/closed, never cleaned up) that an agent could prune.

## What Changes

- `pr.listOpenPrsForRepo` returns `{ prs, error }` instead of a bare array, so a
  failed lookup is distinguishable from "no open PRs".
- Each agent record gains `prLookupError` (the lookup error, or null), `ageDays`
  (days since last commit), and `stale` (true when ageDays > threshold AND no
  open PR AND no uncommitted work — a safe prune candidate).
- Threshold via `GUARDEX_MCP_STALE_DAYS` (default 14).
- `gx mcp list-agents` shows `⚠ STALE Nd` and `PR? (lookup failed)`; tool
  descriptions updated.

## Impact

- **Affected**: `src/pr.js`, `src/mcp/collect.js`, `src/mcp/server.js`,
  `src/cli/commands/mcp.js`. `listOpenPrsForRepo` return shape changed (only
  consumer is the mcp collector). Read-only; no repo mutation.
- Verified by `test/mcp-collect.test.js` (daysSince / stale fixture / prLookupError).
