## ADDED Requirements

### Requirement: VS Code Active Agents nested repo targeting
The VS Code Active Agents `Start agent` command SHALL allow users to target a nested Git repository discovered below the workspace root.

#### Scenario: Workspace has nested storefront and backend repos
- **WHEN** the workspace contains nested Git repositories such as `apps/storefront` and `apps/backend`
- **AND** the user runs `Start agent` from the Active Agents view
- **THEN** the extension prompts for the target Git repo
- **AND** the spawned terminal uses the selected nested repo as its cwd
- **AND** the launcher command creates a Guardex agent branch/worktree for that nested repo instead of changing the visible nested repo's `main` checkout in place.

#### Scenario: Workspace has one Git repo
- **WHEN** only one Git repo is available in the workspace
- **THEN** the extension keeps the existing direct start flow without an unnecessary picker.
