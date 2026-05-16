## Why

Operators need a tiny `gx cockpit` entry point that opens a repo-scoped tmux workspace without starting any Guardex agents or adding cockpit keybindings yet.

## What Changes

- Add a `gx cockpit` CLI command.
- Create the default `guardex` tmux session in the resolved repo root when it does not exist.
- Attach to an existing session, or attach after creation when `--attach` is passed.
- Start the initial control pane with `gx agents status`.
- Report a helpful error when tmux is not installed.

## Impact

- Affected surfaces: `src/cli/main.js`, `src/context.js`, `src/cockpit/index.js`, `src/tmux/session.js`, `test/cockpit-command.test.js`.
- No agents are launched and no cockpit keyboard shortcuts are added.
