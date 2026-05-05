# dmux-style cockpit — Phase 4: logs viewer

## Why

Phase 1 wired the `[l]ogs` hotkey, phases 2-3 advertised it on the
welcome screen and shipped a similar overlay shape for projects. Phase
4 turns the placeholder logs panel into a real log viewer with the
same `[1] All [2] Info [3] Warnings [4] Errors [5] By Pane` filter row
the dmux UI uses.

## What changes

- New `src/cockpit/logs-reader.js`:
  - `readLogs({ repoRoot, fs, sources, limit, tailBytes })` — walks
    `apps/logs`, `.omc/logs`, `.omx/logs` (override via `sources`),
    tails each `.log` file (default 32 KiB), splits into lines,
    classifies each line with `classifyLevel`, returns
    `{ entries, sources, counts }`.
  - `classifyLevel(line)` — heuristic matcher for `error`, `warning`,
    `debug`, default `info`.
  - `filterEntries(entries, filter)` — slices by level or groups by
    source for `by-pane`.
  - `tallyLevels(entries)` — count summary.
- Real `renderLogsPanel`:
  - Heading, summary row (`N total · N info · N warn · N err`),
    `filter:` line, `sources:` count, the dmux filter row, then up to
    20 most-recent entries tagged `[INF]`/`[WRN]`/`[ERR]`/`[DBG]` with
    source path and message.
  - Footer hints: `r: rescan   Esc: back to main`.
- Control state hooks:
  - Pressing `l` populates `state.logs` / `state.logsCounts` /
    `state.logsSources` / `state.logsFilter` lazily on first entry.
  - `1` / `2` / `3` / `4` / `5` swap the active filter.
  - `r` rescans (re-reads log tails).
  - `Esc` returns to main (existing behavior).

## Impact

- New module is filesystem-injectable for unit tests (no real disk
  I/O required in CI).
- ASCII-only renderer; no unicode glyphs.
- No safety-model change: branches, worktrees, locks, PR-only finish
  flow are untouched.

## Out of scope (later phases)

- Phase 5: New-agent prompt overlay.
- Phase 6: Terminal pane action wiring.
- Future: live tail (currently re-reads on `r`), scroll buffer beyond
  the last 20 entries, color-coded levels, copy-to-clipboard.
