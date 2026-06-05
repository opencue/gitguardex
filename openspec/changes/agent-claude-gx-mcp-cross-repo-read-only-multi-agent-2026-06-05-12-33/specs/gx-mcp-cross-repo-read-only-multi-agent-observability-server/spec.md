## ADDED Requirements

### Requirement: Read-only cross-repo agent observability over MCP
The system SHALL provide a `gx mcp serve` stdio MCP server that exposes
read-only tools reflecting current git, worktree, file-lock, and PR state. The
server SHALL NOT mutate any repository.

#### Scenario: Protocol handshake and tool discovery
- **WHEN** an MCP client sends `initialize` then `tools/list`
- **THEN** the server returns its `serverInfo` and tools capability
- **AND** `tools/list` returns exactly `list_agents`, `repo_state`, `who_owns`, and `my_context`, each with a description and an object input schema.

#### Scenario: List active agent lanes across repos
- **WHEN** `list_agents` is called
- **THEN** it returns one record per active agent lane (a worktree on a non-protected branch) across all discovered repos
- **AND** each record carries repo, branch, worktree, task, the files it is editing right now (`dirty`), held locks, last commit, and the open PR for the branch
- **AND** a repo and its linked worktrees are counted as a single repo (deduped by main root)
- **AND** PR lookups are opt-in for `list_agents` (default off) to bound the cross-repo `gh` fan-out, while single-repo `repo_state`/`my_context` include PRs by default.

#### Scenario: Live in-progress edits independent of locks
- **WHEN** a lane has uncommitted changes that have not been lock-claimed (locks materialize at commit time)
- **THEN** the lane's `dirty` field lists those changed files (excluding gitguardex runtime state under `.omx/`/`.omc/`), giving a live "currently editing" signal.

#### Scenario: Cross-worktree lock ownership
- **WHEN** `who_owns(file)` is called for a path locked by another agent in a different worktree
- **THEN** it returns that branch/agent as the owner, aggregating per-worktree lock files across the whole repo
- **AND** returns `owner: null` for an unclaimed path.

#### Scenario: Surface unsafe primary-checkout editing
- **WHEN** a lane is the primary checkout sitting on a non-protected branch
- **THEN** its record includes a warning that edits there risk auto-stash/revert.

#### Scenario: Best-effort, never-throwing PR lookup
- **WHEN** a branch has no upstream, or `gh` is missing/unauthenticated
- **THEN** the PR field is `null` and the call still succeeds (no throw, no partial failure).

### Requirement: Dependency-free server and opt-in registration
The MCP server SHALL be implemented without adding a third-party MCP SDK
dependency, and SHALL NOT be wired into any agent harness automatically.

#### Scenario: Registration guidance
- **WHEN** the user runs `gx mcp register`
- **THEN** the command prints how to register the server (`claude mcp add` and a `.mcp.json` snippet) without modifying any configuration file.
