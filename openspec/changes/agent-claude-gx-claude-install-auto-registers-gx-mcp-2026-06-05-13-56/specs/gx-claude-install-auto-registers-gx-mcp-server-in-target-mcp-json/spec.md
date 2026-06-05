## ADDED Requirements

### Requirement: gx claude install registers the gx MCP server
`gx claude install` SHALL register the read-only `gx` MCP server in the target
repo's `.mcp.json`, unless `--no-mcp` is passed.

#### Scenario: Fresh repo
- **WHEN** `gx claude install` runs in a repo with no `.mcp.json`
- **THEN** it creates `.mcp.json` containing `mcpServers.gx = { command: "gx", args: ["mcp", "serve"] }`.

#### Scenario: Merge into existing config
- **WHEN** `.mcp.json` already defines other MCP servers
- **THEN** install adds the `gx` server and leaves the other servers unchanged.

#### Scenario: Idempotent
- **WHEN** install runs again with the `gx` server already present and correct
- **THEN** the file is unchanged.

#### Scenario: Opt out
- **WHEN** `gx claude install --no-mcp` runs
- **THEN** no `.mcp.json` is created or modified.

### Requirement: check and uninstall cover the MCP registration
`gx claude check` SHALL report missing registration, and `gx claude uninstall`
SHALL remove it.

#### Scenario: Drift detected
- **WHEN** `gx claude check` runs and `.mcp.json` lacks the `gx` server
- **THEN** it reports a warning, and `gx claude doctor` repairs it via install.

#### Scenario: Clean removal
- **WHEN** `gx claude uninstall --yes` runs
- **THEN** the `gx` server is removed from `.mcp.json`, and the file is deleted if it held only the `gx` server, while any other servers are preserved.
