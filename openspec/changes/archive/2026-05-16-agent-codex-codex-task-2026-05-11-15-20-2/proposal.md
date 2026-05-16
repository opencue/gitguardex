## Why

- VS Code Source Control can show a parent workspace repo plus nested Git repos such as `apps/storefront` and `apps/backend`.
- Starting a Guardex lane from the Active Agents sidebar previously defaulted to the workspace folder, so users could not choose the nested repo that owns the visible `main` branch they want to keep stable.
- The launcher should make the selected nested repo the command cwd, allowing `gx branch start` to create an isolated `agent/*` branch/worktree for that repo without switching its visible `main` checkout.

## What Changes

- Discover nested Git repos under workspace folders with a bounded filesystem scan that skips managed worktrees and build/dependency folders.
- Prompt for the target repo when the workspace contains more than one Git repo, including nested repos.
- Keep the extension template copy in sync and cover nested repo targeting with a focused Active Agents regression.

## Impact

- Affects the VS Code Active Agents `Start agent` command only.
- Single-repo workspaces keep the previous no-picker flow.
- The scan is depth-limited to avoid walking large dependency/build trees.
