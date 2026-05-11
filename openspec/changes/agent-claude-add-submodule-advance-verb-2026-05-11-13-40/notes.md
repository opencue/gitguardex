# add-submodule-advance-verb (T1)

Branch: `agent/claude/add-submodule-advance-verb-2026-05-11-13-40`

## Why

Phase A made `gx setup` write `pull.recurseSubmodules=true` so `git pull` auto-updates submodule working dirs. But the pointer-bump step (telling the parent "your storefront should now point at the new SHA") still requires manual ritual: `cd apps/storefront && git fetch && git checkout origin/main && cd ../.. && git add apps/storefront && git commit`.

`gx submodule advance` is the verb that automates this.

Phase B name is `advance` (not `sync` — `git submodule sync` already means something else: syncing `.gitmodules` URLs into `.git/config`).

## Behavior

```
gx submodule advance [<path>] [--push] [--dry-run] [--branch <ref>] [--no-commit] [--target <path>]
```

For each submodule listed in `.gitmodules` (or only the one matching `<path>` if given):

1. If the submodule dir is uninitialized → would-init (dry-run) or `git submodule update --init <path>` (live).
2. If the submodule has uncommitted changes → `skipped-dirty`. Never overwrites in-progress work.
3. Fetch `origin` inside the submodule.
4. Resolve `origin/<branch>` (from `.gitmodules` `branch =` field, default `main`, override with `--branch`).
5. If pointer SHA == remote SHA → `unchanged`.
6. Otherwise: dry-run → `would-advance`; live → checkout the new SHA inside the submodule, stage the pointer bump in the parent.
7. After processing all targets: if any were bumped AND the parent is on a non-protected branch AND the working tree is otherwise clean → commit `chore: bump submodule pointer(s) (<paths>)` with a body listing `<short before>..<short after>` per submodule.
8. `--push` adds a parent push after commit.

Safety rails:

- Skips dirty submodules — never overwrites local work.
- Refuses to commit on a protected branch (e.g. `main`, `dev`): pointer bumps are staged but message tells user to `gx branch start` first or commit manually.
- Refuses to commit when working tree has unrelated changes — only commits if the only modifications are the submodule pointers it just staged.

## Files

- `src/submodule/index.js` — new module: `parseGitmodules`, `advance`, `printAdvanceResult`.
- `src/cli/main.js` — import `submoduleModule`, add `submodule(rawArgs)` function with `advance` subverb + help text, wire `command === 'submodule'` dispatch.

## Verification

Against `medusa-shops/compastor` (submodules dirty):

```
- skipped-dirty  apps/backend     [main] (submodule has local uncommitted changes; refusing to overwrite)
- skipped-dirty  apps/storefront  [main] (submodule has local uncommitted changes; refusing to overwrite)
```

Against `medusa-shops/lifted/LIFTEDV2` (the screenshot — pointers behind remote):

```
- would-advance  apps/storefront 9a8f96ff..67d6c33b  [origin/main]
- would-advance  apps/backend    89a12d0f..df91a450  [origin/main]
```

Both behaviors match expected design.

## Follow-ups (Phase C, separate PR)

Workspace-aware `gx branch finish` — for the *agent* path, where an agent merges a submodule PR and the parent finish should auto-advance + commit the pointer. Phase B is the *user-facing* manual verb; Phase C is the lane-aware automation that calls similar plumbing on agent completion.

## Cleanup

- [x] Dry-run smoke test on compastor (refused-dirty) and LIFTEDV2 (would-advance).
- [ ] Run: `gx branch finish --branch agent/claude/add-submodule-advance-verb-2026-05-11-13-40 --base main --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
