## Why

- Guardex already documents a polished VS Code Source Control view, but the repo does not ship a real companion that surfaces live agent lanes inside VS Code.
- Users need a concrete way to see running Guardex/Codex sandboxes without reading lock JSON or switching to terminal status output.

## What Changes

- Add repo-local active-session state that `scripts/codex-agent.sh` writes while a sandbox session is running and removes on exit.
- Add a lightweight VS Code companion extension that contributes an `Active Agents` view inside the Source Control container and renders one spinning row per live session.
- Add a local install path for the companion extension so users can enable it in their real VS Code without publishing to the Marketplace first.

## Impact

- Affected surfaces: `scripts/codex-agent.sh`, new session-state/install helpers, README, tests, and a new `vscode/guardex-active-agents` companion directory.
- Primary risk is stale or misleading session rows if lifecycle cleanup fails, so the companion must ignore dead PIDs and the writer must remove state on wrapper exit.
- The companion should stay native to VS Code constraints by using built-in spinning codicons instead of custom animated SVGs.
