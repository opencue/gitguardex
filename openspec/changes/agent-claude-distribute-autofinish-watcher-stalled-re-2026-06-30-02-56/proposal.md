## Why

`gx claude install` bakes a SessionStart hook calling `scripts/agent-stalled-report.sh` into a target repo's `settings.json` (via `TEMPLATE_DEFAULT_SETTINGS`), but neither that shim nor the watcher it wraps (`scripts/agent-autofinish-watch.sh`, shipped in #665) was ever delivered to target repos: `gx claude install` only copies `.claude/hooks/*.py`, and the two scripts were absent from `TEMPLATE_FILES`. Result: every target repo got a hook pointing at a missing script, so stalled-worktree recovery silently no-op'd everywhere except gitguardex itself.

## What Changes

- Move `scripts/agent-stalled-report.sh` and `scripts/agent-autofinish-watch.sh` to `templates/scripts/` (the real files) and replace `scripts/<file>` with tracked symlinks — the PAIRED convention used by `agent-preflight.sh`.
- Register both in `TEMPLATE_FILES` (`src/context.js`) so `gx setup` copies them verbatim into a target's `scripts/`, and in `scripts/check-script-symlinks.sh` so the pairing stays enforced.
- Extend `test/setup.test.js` `requiredFiles` to assert both land after setup.

## Impact

- Affected surfaces: `src/context.js`, `scripts/check-script-symlinks.sh`, `templates/scripts/` (2 new), `scripts/` (2 → symlinks), `test/setup.test.js`.
- Delivery vector is `gx setup` / `gx doctor` (which scaffold `TEMPLATE_FILES`), NOT `gx claude install` (which never touches `scripts/`). No `claude.js` / `MANAGED_HOOK_FILES` change is needed — that earlier-suspected lever was wrong.
- Low risk: additive distribution following an existing precedent; verified end-to-end that `gx setup --target` delivers both scripts as runnable executables.
