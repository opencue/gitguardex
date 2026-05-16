## ADDED Requirements

### Requirement: Active Agents rows expose synthetic branch decoration URIs
The VS Code Active Agents companion SHALL assign each session row a synthetic `gitguardex-agent://<sanitized-branch>` resource URI so tree decorations can target live Guardex branches without pointing at a real file on disk.

#### Scenario: Session rows use sanitized branch identity
- **WHEN** the companion renders a live session row
- **THEN** the row `resourceUri` uses the `gitguardex-agent` scheme
- **AND** the URI path is derived from the branch name with the same sanitization used for session-state filenames.

### Requirement: Idle clean sessions are color-coded by elapsed time
The VS Code Active Agents companion SHALL decorate clean live sessions according to how long they have stayed idle.

#### Scenario: Clean session idle longer than ten minutes warns in yellow
- **WHEN** a live session has no working changes and has been running for more than 10 minutes but not more than 30 minutes
- **THEN** the session row decoration uses a yellow warning color
- **AND** the decoration tooltip reads `idle 10m+`.

#### Scenario: Clean session idle longer than thirty minutes warns in red
- **WHEN** a live session has no working changes and has been running for more than 30 minutes
- **THEN** the session row decoration uses a red error color
- **AND** the decoration tooltip reads `idle 30m+`.

#### Scenario: Working sessions keep their existing styling
- **WHEN** a live session currently has working changes in its sandbox worktree
- **THEN** the decoration provider returns no color override for that row.

### Requirement: Tree refreshes also refresh idle decorations
The VS Code Active Agents companion SHALL invalidate session decorations whenever the tree data refreshes.

#### Scenario: Refresh path fires decoration updates
- **WHEN** the tree refresh callback runs because of timers, watchers, or manual refresh
- **THEN** the file-decoration provider emits `onDidChangeFileDecorations`
- **AND** idle decoration colors can update without reloading the extension host.
