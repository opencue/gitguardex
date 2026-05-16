## Definition of Done

- Branch `MERGED` on `origin`, PR URL captured.

## 1. Implementation

- [x] 1.1 Add `src/speckit/index.js` (subcommand module + `installSpeckit` helper).
- [x] 1.2 Wire `gx speckit` into `src/cli/main.js` dispatch via `lazyProxy`.
- [x] 1.3 Add `speckit` to `CLI_COMMAND_DESCRIPTIONS` + the "Agents & reports" group in `src/context.js`.

## 2. Smoke

- [x] 2.1 `node bin/multiagent-safety.js speckit --help` prints the new help.
- [x] 2.2 `node bin/multiagent-safety.js --help` shows `speckit` in the catalog.
- [x] 2.3 `node bin/multiagent-safety.js speckit --dry-run` (in a tmp git repo) detects the system `specify` binary, prints what it would do, and exits 0.
- [x] 2.4 `node --check src/speckit/index.js src/cli/main.js src/context.js` clean.
- [x] 2.5 `node --test test/*.test.js` → 539 pass / 23 fail (failures all pre-existing in branch / cockpit / welcome tests; none touch speckit).

## 3. Ship

- [ ] 3.1 Commit + push + PR vs `main` + squash auto-merge.
- [ ] 3.2 Record PR URL + `MERGED` state.
- [ ] 3.3 Confirm sandbox worktree pruned post-merge.
