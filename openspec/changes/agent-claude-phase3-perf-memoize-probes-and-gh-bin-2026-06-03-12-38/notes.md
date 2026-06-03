# phase3-perf-memoize-probes-and-gh-bin (minimal / T1)

Branch: `agent/claude/phase3-perf-memoize-probes-and-gh-bin-2026-06-03-12-38`

Phase 3 of the gitguardex improvement plan: perf + correctness. No observable behavior change. 3 files, +28.

## Scope

- **B1** `src/core/runtime.js`: route `run()` through `context.cachedSpawn` instead of raw `spawnSync`.
  cachedSpawn caches ONLY a strict allowlist (git geometry probes, git/gh `--version`, `which`/`command`/`type`);
  writes, ref resolution, npm, gh auth/pr all fall through to a real spawn. Dedups redundant probes process-wide.
- **B2** `src/toolchain/index.js`: memoize `detectGlobalToolchainPackages` (slow `npm list -g`, ~1.5s).
  Bare-`gx` queries it 2× (openspec update-check `toolchain:181` + status snapshot `status.js:30`) → now 1×.
  Busted via `resetGlobalToolchainDetectionCache()` after a successful global `npm i -g`; reset exported.
- **B6** `src/budget/index.js`: `runGh` uses imported `GH_BIN` (honors `GUARDEX_GH_BIN`/`ghx`) instead of hardcoded `'gh'`.

## Verification

- `node --test test/*.test.js`: 563 pass / 34 fail / 1 skip. Failing set is **byte-identical** to base
  (stash-isolated diff: `comm` shows zero new failures, zero fixed). The 34 are pre-existing env/CI baseline.
- Benchmark (counted `npm list -g` spawns, bare `gx`, fake npm): **baseline 2 → memoized 1**.
- Memo identity proven (2nd call `===` cached; reset re-probes). Modules load clean; `gx --help`/`prompt --snippet` OK.
- Independent review: NO BLOCKING FINDINGS (verified post-install re-detect at `status.js:143-146` is handled by the reset).

## Follow-ups (out of scope)

- `src/cli/shared/toolchain-shims.js:285` has a documented-dead duplicate of `detectGlobalToolchainPackages`
  (un-memoized). Latent footgun if re-wired; candidate for a later dead-code pass.

## Cleanup

- [ ] Finish via the GATED path (not bare `--wait-for-merge`, which is fail-open): `/autoship` or `gx branch finish --gate-review`.
- [ ] Record PR URL + `MERGED` state. NOTE: repo CI `test (node 20)` is baseline-RED (PR #613 merged red), so green-CI gating may block.
- [ ] Confirm sandbox worktree pruned.
