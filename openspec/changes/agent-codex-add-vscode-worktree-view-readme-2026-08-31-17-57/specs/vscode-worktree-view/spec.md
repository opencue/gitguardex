## ADDED Requirements

### Requirement: Explicit VS Code worktree overview
GitGuardex SHALL provide `gx setup --vscode-worktree-view` to create a multi-root
VS Code workspace containing the primary repository plus the managed Codex and
Claude worktree roots.

#### Scenario: Operator enables the worktree overview
- **WHEN** `gx setup --vscode-worktree-view` runs for a repository
- **THEN** GitGuardex creates `<parent>/<repo>-branches.code-workspace`
- **AND** the workspace includes the repository, `.omx/agent-worktrees`, and
  `.omc/agent-worktrees` as folders
- **AND** VS Code Source Control is configured to discover and show repositories
  below those folders.

#### Scenario: Existing option remains compatible
- **WHEN** `gx setup --parent-workspace-view` runs
- **THEN** it produces the same explicit worktree overview.

### Requirement: Default workspace remains conservative
GitGuardex SHALL NOT enable nested worktree discovery in the repository's normal
VS Code settings merely because the explicit overview feature exists.

#### Scenario: Operator does not opt in
- **WHEN** setup runs without either worktree-view option
- **THEN** no parent `.code-workspace` file is created
- **AND** the repository-level worktree scan protections remain unchanged.

### Requirement: Visual capability documentation
The README SHALL present the lane lifecycle in a dark structured visual and SHALL
show a real VS Code example of separately listed agent worktrees.

#### Scenario: Reader reviews capabilities
- **WHEN** the capability section is rendered on GitHub
- **THEN** the workflow diagram and VS Code screenshot load successfully
- **AND** the opt-in setup command is shown next to the screenshot.
