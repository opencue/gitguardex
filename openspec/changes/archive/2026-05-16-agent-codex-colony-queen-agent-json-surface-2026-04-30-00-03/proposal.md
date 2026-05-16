## Why

- Colony takeover and Queen-plan lanes need machine-readable Guardex surfaces so another agent can resume, inspect, and finish work without scraping human text.

## What Changes

- Extend `gx agents start --dry-run --json` with branch, worktree, launch command, claims, tmux, and Colony metadata.
- Extend `gx agents status --json` and cockpit state with activity, claims, changed files, metadata, launch command, and PR evidence.
- Extend `gx agents finish --json` with PR, merge, cleanup, and status evidence written back to session metadata.

## Impact

- Existing text output remains human-readable.
- JSON output is additive and versioned with `schemaVersion: 1`.
