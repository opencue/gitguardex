# Tasks

## 1. Spec
- [x] 1.1 Capture proposal in `proposal.md`
- [x] 1.2 Capture spec delta in `specs/cockpit-logs/spec.md`

## 2. Tests
- [x] 2.1 Add `test/cockpit-logs.test.js` covering `classifyLevel`,
       `readLogs`, `filterEntries`, `tallyLevels`, the 1-5 filter
       hotkeys, and the rendered logs panel.
- [x] 2.2 Verify existing cockpit-projects, cockpit-control, and
       cockpit-sidebar tests still pass.

## 3. Implementation
- [x] 3.1 Add `src/cockpit/logs-reader.js` with `readLogs`,
       `classifyLevel`, `filterEntries`, `tallyLevels`, `tailFile`,
       `listLogPaths`, and the `LEVELS` / `DEFAULT_*` constants.
- [x] 3.2 Replace placeholder `renderLogsPanel` in
       `src/cockpit/control.js` with a real viewer (summary, filter
       row, tagged entries, footer hints, empty state).
- [x] 3.3 Add `loadLogsState` helper and call it from
       `openActionRow('logs')` so the entries are hydrated lazily.
- [x] 3.4 In `applyKey`, route `1`-`5` to filter swaps and `r` to
       rescan when `mode === 'logs'`.

## 4. Cleanup
- [ ] 4.1 Commit changes on the agent branch.
- [ ] 4.2 Push branch and open a PR.
- [ ] 4.3 Run `gx branch finish ... --via-pr --wait-for-merge --cleanup`.
- [ ] 4.4 Record PR URL and `MERGED` evidence.
