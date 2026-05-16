## ADDED Requirements

### Requirement: Active Agents tree surfaces colony task counts per repo

When the local colony worker is reachable, the Active Agents tree in `vscode/guardex-active-agents/extension.js` SHALL enrich each repo's Overview summary with the count of colony tasks and the count of pending handoffs known to that repo, and SHALL NOT alter the tree when no tasks or handoffs are known.

#### Scenario: Repo with colony tasks includes counts in the Overview summary
- **GIVEN** the colony worker is listening on `127.0.0.1:<workerPort>` and `/api/colony/tasks?repo_root=<repoRoot>` returns at least one task with a `pending_handoff_count` > 0
- **WHEN** the Active Agents tree refreshes
- **THEN** the repo's Overview `Summary` description contains the segments `N colony task(s)` and `M pending handoff(s)` joined by ` · ` with the existing working/finished/idle/unassigned/locked/conflict segments.

#### Scenario: Worker unavailable falls back silently
- **GIVEN** no process is listening on the configured colony port, or the fetch times out within `COLONY_FETCH_TIMEOUT_MS`
- **WHEN** the Active Agents tree refreshes
- **THEN** the Overview description and tree structure are identical to the pre-change rendering and no error is surfaced to the user.

#### Scenario: Fetch is cached per repo root for a short TTL
- **GIVEN** the tree has fetched `/api/colony/tasks?repo_root=<repoRoot>` within the last `COLONY_SNAPSHOT_TTL_MS`
- **WHEN** the tree refreshes again for the same repo root
- **THEN** the extension reuses the cached response rather than issuing another HTTP request.

### Requirement: Advanced details expose a Colony tasks section

When at least one colony task is known for a repo, `getChildren(RepoItem)` SHALL append a collapsed `Colony tasks` section inside `Advanced details` listing one row per task.

#### Scenario: Task with pending handoff renders a warning row
- **GIVEN** a colony task with `pending_handoff_count` >= 1 and at least one participant
- **WHEN** the user expands `Advanced details` then `Colony tasks`
- **THEN** the task row's label is `#<id> · <compact branch label>`, its description is `<participant agents, comma-separated> · N pending handoff(s)`, and its icon id is `warning`.

#### Scenario: Task without pending handoffs renders a quiet row
- **GIVEN** a colony task with `pending_handoff_count` === 0
- **WHEN** the user expands `Colony tasks`
- **THEN** the task row's description ends in `quiet` and its icon id is `comment-discussion`.

### Requirement: Colony port is resolved from the colony data dir settings file

The extension SHALL resolve the colony worker port from `$COLONY_HOME/settings.json` (or `$CAVEMEM_HOME/settings.json`, or `~/.colony/settings.json` when neither env var is set), defaulting to `37777` when the file is absent, unreadable, or does not contain a positive `workerPort`.

#### Scenario: Settings file contains an explicit port
- **GIVEN** the resolved settings path contains `{"workerPort": 38000}`
- **WHEN** the extension issues a colony fetch
- **THEN** it connects to `127.0.0.1:38000`.

#### Scenario: Settings file is absent
- **GIVEN** no settings file exists at the resolved path
- **WHEN** the extension issues a colony fetch
- **THEN** it connects to `127.0.0.1:37777`.
