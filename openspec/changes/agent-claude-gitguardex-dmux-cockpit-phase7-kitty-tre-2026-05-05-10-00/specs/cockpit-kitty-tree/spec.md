## ADDED Requirements

### Requirement: Cockpit ships a kitty-tree reader module
The cockpit SHALL expose a `kitty-tree` module that runs `kitty @ ls`
against the configured remote-control socket and returns a normalized
tree containing the current user, session label, focused OS-window id,
and a flat list of windows with classified kinds (`control`,
`agent`, `shell`).

#### Scenario: readKittyTree parses the kitty @ ls JSON output
- **WHEN** `readKittyTree({ env: { KITTY_LISTEN_ON, USER }, runner })`
  is called with a runner that returns `status: 0` and the kitty
  `@ ls` JSON payload for one OS-window with three windows
  (`gx cockpit`, a codex agent, a bash shell)
- **THEN** the result has `error === ''`
- **AND** `result.user` equals the `USER` env var
- **AND** `result.windows` has length 3 with kinds
  `['control', 'agent', 'shell']`.

#### Scenario: Missing socket falls back to an empty tree
- **WHEN** `readKittyTree({ env: {} })` is called with no
  `KITTY_LISTEN_ON` set
- **THEN** the result has `windows: []` and `error` matches `/no
  KITTY_LISTEN_ON/`.

### Requirement: Sidebar renders the kitty tree above the shortcut block
The cockpit sidebar SHALL render the kitty window tree (when present
on `state.kittyTree`) between the agent lanes block and the dmux-style
shortcut block. The tree SHALL list the user, the session label, and
each window with a `>` cursor on the focused row plus a short kind
tag (`[gx]`, `[cx]`, `[ba]`, `[sh]`).

#### Scenario: Sidebar surfaces the tree when populated
- **WHEN** `renderSidebar` is called with `state.kittyTree` populated
  (user `deadpool`, session `gitguardex`, three windows with the
  first focused)
- **THEN** the rendered output contains a line `^deadpool$`
- **AND** the focused row matches `>\s+gx cockpit`
- **AND** every other window appears in the output with a kind tag.

#### Scenario: Sidebar omits the tree when no state
- **WHEN** `renderSidebar` is called with no `kittyTree` field on the
  state
- **THEN** the rendered output does NOT contain a `^deadpool$` line.
