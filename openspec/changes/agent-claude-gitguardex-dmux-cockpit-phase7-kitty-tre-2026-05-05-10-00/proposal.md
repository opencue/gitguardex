# dmux-style cockpit — Phase 7: kitty window tree in the sidebar

## Why

The user wants the cockpit sidebar to mirror dmux's session tree:
`<user> > <session-name> > <pane-1> · <pane-2> · ...`. Today the
sidebar shows the agent lanes plus the dmux-style shortcut block, but
nothing tracks the actual Kitty windows the user has open inside the
spawned cockpit OS-window. So when they split with Ctrl+Shift+Enter
or Ctrl+Shift+\ in Kitty, the new pane is invisible to the cockpit.

Phase 7 adds a live Kitty-window tree to the sidebar — populated from
`kitty @ ls` — so every pane (control, agent lanes, shells) is listed
under the user/session header with a focus marker.

## What changes

- New `src/cockpit/kitty-tree.js`:
  - `readKittyTree({ env, socket, runner, osWindowId })` runs
    `kitty @ ls --to=<sock>`, parses the JSON, and returns
    `{ user, sessionLabel, osWindowId, windows, error }`.
  - `flattenOsWindow` extracts windows from nested `tabs[].windows[]`.
  - `classifyWindow` heuristically tags each window as `control`,
    `agent`, or `shell` (used by the sidebar to print short tags).
  - `pickOsWindow` defaults to the focused entry but accepts an
    `osWindowId` override.
- `src/cockpit/sidebar.js` gains `renderKittyTreeRows(state, width,
  options)` and calls it inside `renderSidebar` between the agent
  lanes and the shortcut block. The tree renders as:
  ```
  deadpool
    gitguardex
    >  gx cockpit                                 [gx]
       codex codex                                [cx]
       shell-1                                    [ba]
  ```
- The cockpit sidebar gracefully omits the tree section when no
  `state.kittyTree` is set, and prints `(kitty: <error>)` when the
  reader returned a non-empty `error` field.

## Impact

- Reader is fully runner-injectable for unit tests (no real Kitty
  required in CI).
- Sidebar tests assert the new rows render only when the tree is
  populated; legacy tests with no tree state continue to render the
  pre-phase-7 sidebar layout.
- Future PRs can populate `state.kittyTree` in the cockpit-control
  refresh loop (call `readKittyTree` on every tick); this PR ships
  the data + render plumbing only.
- No safety-model change.
- ASCII-only renderer.
