## Why

`gx mcp` (the read-only cross-repo agent radar) only helps if agents actually
have it registered. Today that means a manual `claude mcp add gx -s user -- gx
mcp serve` per machine — so in practice nobody turns it on and the collision
visibility never reaches the agents that need it. `gx claude install` already
wires the rest of the gitguardex Claude integration into a repo; the MCP server
should ride along.

## What Changes

- `gx claude install` now also registers the `gx` MCP server in the target
  repo's `.mcp.json` (`{ "mcpServers": { "gx": { "command": "gx", "args":
  ["mcp", "serve"] } } }`). It MERGES into an existing `.mcp.json` without
  disturbing other servers, and is idempotent.
- `--no-mcp` opts out of the registration.
- `gx claude check` reports a warning when the `gx` server is missing; `gx
  claude doctor` (check --fix) repairs it via install.
- `gx claude uninstall` removes the `gx` server (and deletes `.mcp.json` if it
  only held ours).

## Impact

- **Affected surface**: `src/cli/commands/claude.js` only (install/check/uninstall
  + usage). New exports `installMcpServer`, `MCP_REL`, `MCP_SERVER_KEY`.
- **Behavior change**: installing gitguardex into a repo now adds a committed
  `.mcp.json`; Claude Code will prompt to approve the project MCP server. Opt out
  with `--no-mcp`. Read-only server, no repo mutation at runtime.
- **Portability**: `.mcp.json` references `gx` on PATH; a clone without gx shows
  the server as unavailable (soft failure), not an error.
- Verified by `test/claude-install.test.js` (create / merge / idempotent /
  dry-run) plus end-to-end smoke of install/merge/--no-mcp/uninstall.
