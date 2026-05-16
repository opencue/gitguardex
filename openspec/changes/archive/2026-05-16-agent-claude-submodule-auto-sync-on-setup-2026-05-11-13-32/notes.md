# submodule-auto-sync-on-setup (T1)

Branch: `agent/claude/submodule-auto-sync-on-setup-2026-05-11-13-32`

## Why

Monorepo shops (`medusa-shops/lifted`, `compastor`, `koronakert`, `teherguminet`, …) pin `apps/backend` and `apps/storefront` as independent submodule repos. When an agent commits inside a submodule (in a separate `.omc/agent-worktrees/...` lane) and the parent PR merges, the user's primary checkout never updates the submodule working dir until they manually run `git submodule update --init --recursive`. Symptom: `pnpm storefront:dev` shows stale code, looking like the agent did nothing.

`submodule.recurse=true` would fix this but also affects `push` and cascades into the Codex external-remote approval block (S715/S716). Targeted pair is safer and pull-only.

## Change

In `runSetupBootstrapInternal` (src/cli/main.js), after `ensureSetupProtectedBranches`, call a new `ensureSubmoduleAutoSync(repoRoot, dryRun)` helper (src/git/index.js).

The helper:
1. Returns `[]` immediately if `<repoRoot>/.gitmodules` is absent — non-monorepo repos are untouched.
2. For each of `pull.recurseSubmodules=true` and `fetch.recurseSubmodules=on-demand`: only writes when the key is unset locally. Pre-existing values are preserved (the user may have a reason).
3. Runs `git submodule update --init --recursive` once to snap working dirs to the parent index — this is the part that fixes the screenshot case where the parent is `0↓ 2↑` (pointer bumps already in the index, working dir stale).
4. Operations show up in the normal `Setup/install` output as `would-set` / `set` / `unchanged` / `synced`.

`submodule.recurse` is intentionally not touched — push behavior stays default.

## Files

- `src/git/index.js` — add `ensureSubmoduleAutoSync` + `SUBMODULE_AUTO_SYNC_CONFIGS`, export.
- `src/cli/main.js` — import + call from `runSetupBootstrapInternal`.

## Verification

Dry-run against `/home/deadpool/Documents/medusa-shops/compastor`:

```
- would-set    git config pull.recurseSubmodules (true (auto-update submodule working dirs on `git pull`))
- would-set    git config fetch.recurseSubmodules (on-demand (fetch submodule commits as parent pointers move))
- would-sync   git submodule update --init --recursive (snap submodule working dirs to parent index)
```

Idempotency: `readGitConfig` returns `''` only when truly unset, so any pre-existing value (including `false`) is preserved and surfaced as `unchanged`.

## Follow-ups (not in this PR)

- Phase B (T1): standalone `gx submodule sync` verb that fetches each submodule, bumps the parent pointer to the tracked branch's remote tip, commits.
- Phase C (T2): workspace-aware `gx branch finish` — fans out child PRs, bumps parent pointer, opens parent PR with dependency.

## Cleanup

- [x] Run dry-run smoke test on compastor — three new ops appear correctly.
- [x] Run: `gx branch finish --branch agent/claude/submodule-auto-sync-on-setup-2026-05-11-13-32 --base main --via-pr --wait-for-merge --cleanup`
- [x] Record PR URL + `MERGED` state in the completion handoff.
- [x] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
