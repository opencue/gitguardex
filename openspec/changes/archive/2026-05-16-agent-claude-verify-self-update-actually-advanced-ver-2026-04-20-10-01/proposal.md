## Why

- `gx`'s self-updater runs `npm i -g @imdeadpool/guardex@latest` and trusts npm's exit code. In a real session we observed npm print "changed 1 package in 156ms" with `status == 0`, after which the globally-installed `package.json` was still at the **prior** version (`7.0.4` on disk while `@latest` resolved to `7.0.5`). The `gx` CLI then announced "✅ Updated to latest published version" and the next `gx` invocation re-detected the available update, prompted the user again, and looped. The root cause is an npm resolution/dedupe cache quirk that can make `@latest` a no-op when the last install on this machine was recent enough or the metadata cache points at a now-stale version.
- The user observed this loop on 2026-04-20 after `npm publish`ing 7.0.5; the workaround was to run `npm i -g @imdeadpool/guardex@7.0.5` manually (pinned version bypasses the cache path that made `@latest` idempotent).

## What Changes

- `bin/multiagent-safety.js::maybeSelfUpdateBeforeStatus`:
  - After the `npm i -g <pkg>@latest` call returns success, re-read the globally-installed `package.json` via `npm root -g` + filesystem read.
  - If the on-disk version differs from the advertised latest, rerun `npm i -g <pkg>@<latest>` with the exact version pinned to force npm past the cache entry that made `@latest` a no-op.
  - If the pinned retry also fails or the on-disk version still doesn't advance, emit a clear next-step hint (`npm root -g && npm cache verify`) and stop the update flow. Previously the CLI claimed "✅ Updated to latest published version" and moved on.
- New helper `readInstalledGuardexVersion()` encapsulates the `npm root -g` + package.json read. It returns `null` when the path can't be resolved (which matches the existing test environment's fake `npm` that doesn't handle `root -g`), so existing test paths that don't simulate a global root continue to behave exactly as before — verification is gated on being able to read the on-disk version.
- `test/install.test.js`: new regression test `self-update verifies on-disk version after @latest install and retries with pinned version when stale`. It uses a fake npm that handles `view` / `list` / `root -g` / `i -g @latest` (stays stale) / `i -g @9.9.9` (advances on disk) and asserts both install invocations happen, the "Installed version is still … Retrying with pinned version 9.9.9" banner is printed, and the final "Updated to latest published version" line still fires.
- `package.json` bump `7.0.5` → `7.0.6`.
- `README.md`: new `### v7.0.6` release note documenting the fix and the hint printed on persistent failure.

## Impact

- **Behavior change**: `gx` no longer announces a successful self-update when the on-disk version hasn't actually advanced. In the observed failure mode it now transparently retries with the pinned version and proceeds normally; in a truly-stuck case the user gets an actionable message instead of an infinite prompt loop.
- **Compat**: All existing self-update tests still pass (`default invocation checks for update and can auto-approve latest install` + `self-update prompt requires explicit y/n when approval is not preconfigured`). Old behavior is preserved when `npm root -g` is unavailable (verification is skipped, as in the existing tests).
- **Surfaces touched**: `bin/multiagent-safety.js`, `test/install.test.js`, `package.json`, `README.md`.
- **Rollout**: requires `npm publish @imdeadpool/guardex@7.0.6` after merge and a pinned upgrade `npm i -g @imdeadpool/guardex@7.0.6` on each dev box to pick up the fix. The pinned upgrade is itself the workaround for this very bug until 7.0.6 is installed.
