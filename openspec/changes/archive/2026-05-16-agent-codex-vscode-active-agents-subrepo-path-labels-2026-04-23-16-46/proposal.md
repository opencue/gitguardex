## Why

- Operators currently have to reload the whole VS Code window when they want GitGuardex Active Agents to restart.
- The extension details page is the place users reach for lifecycle actions, but GitGuardex Active Agents does not currently expose any restart affordance there.

## What Changes

- Add a `Restart Active Agents` command that restarts the extension host instead of reloading the whole window.
- Surface that command on the closest supported VS Code surfaces:
  - the Extensions view gear/context menu for `recodeee.gitguardex-active-agents`
  - the Active Agents view title
- Keep live/template extension files, manifest versions, and focused regression coverage in sync.

## Impact

- Scope is limited to the Active Agents extension manifest, command registration, and focused VS Code extension tests.
- Session discovery, locking, finish flow, and telemetry payloads stay unchanged.
- VS Code does not expose a custom button slot next to built-in `Disable` / `Uninstall`, so the restart affordance must live in the extension gear/context menu instead of the top action row.
