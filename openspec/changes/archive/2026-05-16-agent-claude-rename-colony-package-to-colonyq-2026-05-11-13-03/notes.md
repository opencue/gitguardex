# rename-colony-package-to-colonyq (T1)

Branch: `agent/claude/rename-colony-package-to-colonyq-2026-05-11-13-03`

## Problem

Colony's canonical npm package was renamed from `@imdeadpool/colony-cli` to `colonyq`. Gitguardex still references the old name in `src/context.js:24` (`COLONY_PACKAGE`), so the `gx status` / `gx setup` companion-install prompt shows the wrong command:

```
[gitguardex] Missing companion tools: colony.
Install missing companion tools now? (npm i -g @imdeadpool/colony-cli) [y/n]
```

Accepting installs a deprecated package; declining leaves the user without colony.

## Change

Rename the constant: `COLONY_PACKAGE = 'colonyq'`. The install-command builder in `src/toolchain/index.js:279` constructs `npm i -g <packageName>` from this constant, so the prompt automatically becomes `npm i -g colonyq` and the global-toolchain detection (`npm list -g --depth=0 --json` lookup) checks the right package name.

## Out of scope

The new colony post-install chain — `colony install --ide codex` → `npx skills add recodeee/colony/skills/colony-mcp` → `colony health` — is user-side configuration that colony itself orchestrates. Gitguardex only owns the `npm i -g` step. Adding a `postInstallCommand` field to `GLOBAL_TOOLCHAIN_SERVICES` so gitguardex could chain those is a separate refactor and isn't blocking this rename. Documented as a future follow-up in the inline comment near the constant.

## Verification

- `node --check src/context.js` passes.
- `gx status` (once this lands and is rebuilt/republished) shows `npm i -g colonyq` in the companion prompt.
- Global-toolchain detection now matches against `colonyq` in the `npm list -g` JSON output.

## Cleanup

- [x] `gx branch finish --branch agent/claude/rename-colony-package-to-colonyq-2026-05-11-13-03 --base main --via-pr --wait-for-merge --cleanup`
- [x] Record PR URL + `MERGED` state.
- [x] Confirm sandbox worktree gone.
