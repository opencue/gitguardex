## Why

- The Guardex Active Agents tree in `vscode/guardex-active-agents/extension.js` surfaces session files + file locks, but has no window into colony task threads. Colony already tracks cross-agent tasks, participants, and pending handoffs in `~/.colony/data.db`; the extension currently shows none of that.
- Agents working the same repo with colony MCP tooling split-brain into two UIs: colony viewer at `http://127.0.0.1:37777` and the Active Agents tree in VS Code. Handoffs that need attention are only visible via the viewer.
- Reading colony's SQLite directly from the VS Code extension would pull in a native `better-sqlite3` dep and couple the extension to colony's schema. The colony worker already exposes an HTTP API on `127.0.0.1`; adding thin read-only endpoints keeps the extension dependency-free.

## What Changes

- `vscode/guardex-active-agents/extension.js`:
  - Add `node:http` + `node:os` imports and a colony read helper with 5s per-repo cache and 800ms fetch timeout. Silent fallback to empty results when the worker is off.
  - Port resolution reads `~/.colony/settings.json#workerPort` (honours `COLONY_HOME` / `CAVEMEM_HOME`), falls back to `37777`.
  - Extend `buildRepoOverview` + `buildOverviewDescription` with `colonyTaskCount` + `pendingHandoffCount`.
  - Extend `RepoItem` to carry `colonyTasks`. In `getChildren(RepoItem)` add a collapsed `Colony tasks` section under `Advanced details` listing one `DetailItem` per task (label `#id · branch`, description `participants · pending handoffs|quiet`).
  - `loadRepoEntries` fans out one colony fetch per repo in parallel with the existing decoration.
- No backend or settings changes in this repo; the three new `/api/colony/*` endpoints live in the colony worker (`agents-hivemind` repo) and are consumed here.

## Impact

- **New behavior**: When the colony worker is running, each repo card's summary line includes `N colony tasks · M pending handoffs` when non-zero; expanding `Advanced details` shows a `Colony tasks` list with a warning icon on tasks with pending handoffs.
- **Compat**: When the worker is down the fetch resolves null, `colonyTasks` is `[]`, and the tree renders exactly as today. No new dependencies added to the extension.
- **Surfaces touched**: `vscode/guardex-active-agents/extension.js`.
- **Out of scope**: Clicking into a task to drill into its `/api/colony/tasks/:id/attention` payload (follow-up).
