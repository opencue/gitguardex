# Bare `gx` auto-bootstraps Kitty on TTY

## Why

PR #523 made `gx cockpit` auto-bootstrap a Kitty host window when launched from a non-Kitty TTY. Bare `gx` (no subcommand) on a TTY already routes to `cockpitModule.openDefaultCockpit`, but that path goes through `defaultCockpitBackends('auto', ...)` which gates kitty with `onlyIfAvailable`. The kitty backend's `isAvailable()` requires `kitty @ ls` to already succeed (i.e. remote control already running), so on a regular non-Kitty TTY the kitty candidate is dropped and the cockpit falls back to tmux. Net effect: bare `gx` couldn't deliver the same one-command "spawn fresh Kitty + cockpit" UX as `gx cockpit`.

## What changed

- `defaultCockpitBackends(preferred, terminalBackendOptions, options = {})` now accepts an `autoHostPermitted` flag. When `preferred === 'auto'` and `autoHostPermitted` is true, the kitty backend is added without the strict `onlyIfAvailable` gate so `openWithBackend` → `openKittyCockpit` can run its existing bootstrap path. tmux remains the fallback in the candidate list.
- `openDefaultCockpit` computes `autoHostPermitted` via the existing `shouldAutoHost({}, { env, stdout })` helper (TTY + `KITTY_LISTEN_ON` unset + `GUARDEX_AUTO_HOST` not opted out) and threads it into `defaultCockpitBackends`.
- New `defaultCockpitDisabled()` helper in `src/cli/main.js` returns true when `GUARDEX_DEFAULT_COCKPIT` is `0|false|no|off`. The bare-`gx` no-arg branch now skips the cockpit and prints status when this opt-out is set, matching the existing `GUARDEX_LEGACY_STATUS=1` escape hatch.
- `gx --help` / `gx help` / `gx -h` and the non-TTY (CI/pipe) path are unchanged.

## Verification

```text
node --test test/default-gx-cockpit.test.js
# 7/7 pass (5 existing + 2 new)
```

## Files

- `src/cockpit/index.js`
- `src/cli/main.js`
- `test/default-gx-cockpit.test.js`
- `openspec/changes/agent-claude-bare-gx-auto-bootstrap-kitty-2026-05-05-09-43/notes.md`
