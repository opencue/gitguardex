## ADDED Requirements

### Requirement: Cockpit ships a logs reader module
The cockpit SHALL expose a `logs-reader` module that tails `.log`
files under configurable directories, classifies each line by level,
and returns a stable result with per-level counts.

#### Scenario: readLogs tails .log files and tallies levels
- **WHEN** `readLogs({ repoRoot, fs })` is called against a tree
  containing `apps/logs/server.log` with mixed-severity lines and a
  sibling `README.md`
- **THEN** the returned `entries` exclude the README and include one
  classified entry per non-empty log line
- **AND** the returned `counts` accurately reflect the number of
  `info`, `warning`, `error`, and `debug` entries.

#### Scenario: classifyLevel maps common keywords
- **WHEN** `classifyLevel(line)` is called with lines containing
  `error`, `Exception`, `warning`, or `debug`
- **THEN** the returned levels are `error`, `error`, `warning`, and
  `debug` respectively
- **AND** any line without a matching keyword classifies as `info`.

#### Scenario: filterEntries supports level and by-pane grouping
- **WHEN** `filterEntries(entries, 'error')` is called against a
  mixed list
- **THEN** only entries with `level === 'error'` are returned.
- **AND** `filterEntries(entries, 'by-pane')` returns the entries
  grouped by `source`, preserving relative order within each group.

### Requirement: Logs panel renders the dmux filter row and tagged entries
The cockpit `logs` mode panel SHALL render a summary line with total
and per-level counts, the dmux-style `[1] All [2] Info [3] Warnings
[4] Errors [5] By Pane` filter row, the active filter label, the
source count, and up to 20 most-recent entries tagged with `[INF]`,
`[WRN]`, `[ERR]`, or `[DBG]`. The footer SHALL list `r: rescan` and
`Esc: back to main`.

#### Scenario: Logs panel shows summary, filter row, tagged entries
- **WHEN** the cockpit is in `logs` mode with a known
  `state.logs`, `state.logsCounts`, `state.logsSources`, and
  `state.logsFilter === 'all'`
- **THEN** the rendered panel contains the substring `[1] All  [2]
  Info  [3] Warnings  [4] Errors  [5] By Pane`
- **AND** every line from `state.logs` that ends up in the rendered
  output is prefixed with `[INF]`, `[WRN]`, `[ERR]`, or `[DBG]`
- **AND** the footer contains `r: rescan`.

### Requirement: Logs mode key handlers swap filters and rescan
The cockpit key handler SHALL respond to `1` / `2` / `3` / `4` / `5`
in `logs` mode by setting `state.logsFilter` to `all` / `info` /
`warning` / `error` / `by-pane` respectively. It SHALL respond to `r`
by re-reading the log sources and refreshing the cached entries.

#### Scenario: 1-5 keys swap the active filter
- **WHEN** the cockpit is in `logs` mode with `logsFilter === 'all'`
  and the user presses `2`, then `3`, then `4`, then `5`, then `1`
- **THEN** `logsFilter` becomes `info`, then `warning`, then `error`,
  then `by-pane`, then `all`.
