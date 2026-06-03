# phase1-remove-dead-code-and-frontend-cru (minimal / T1)

Branch: `agent/claude/phase1-remove-dead-code-and-frontend-cru-2026-06-03-10-31`

Phase 1 of the gitguardex improvement plan: remove dead/unneeded code only. No
behavior change, no public CLI/API change. 26 files, ~6274 deletions, 3 insertions.

## Scope

- Deletes (verified not shipped to npm via `npm pack`, zero runtime requires):
  - `frontend/Recodeeplan-handoff.tar.gz` (3.3MB) + `frontend/scripts/**` (stale forks of `templates/scripts/`)
  - `src/agents/detect.js` (+test) — superseded by `registry.getAgentDefinition`
  - `src/cockpit/layout.js`, `src/cockpit/keybindings.js` (+tests) — dead tmux-era modules
- Dead-export / function removals:
  - `src/terminal/index.js` — `selectTerminalBackendForTarget`, `resolveTargetBackendName` + 5 private helpers; `createBackends` kept internal (un-exported)
  - `src/terminal/tmux.js` — `targetId` export (function kept, used internally)
  - `src/context.js` — `clearProbeCache` (no callers)
  - `src/pr.js` — unused `fs`/`path`/`TOOL_NAME` imports, `_internal` + `TOOL_NAME` re-exports
  - `src/cli/commands/pr.js` — dead `? null : null` block in `cmdList`
  - `src/doctor/index.js` — unused `rawRun` import alias + `void rawRun;`
  - `src/cli/args.js` — `collectForceManagedPaths`, `parseRepoTraversalArgs` exports (functions kept, internal)

## Deferred (not in this PR)

- `src/git/index.js` `rawRun` cleanup — base-branch WIP staged there on `main`; do after it lands.
- `src/cockpit/index.js` spread narrowing — belongs with the Phase 4 cockpit lazy-require.

## Verification

- `node --test test/*.test.js`: 548 pass / 25 fail / 1 skip. The 25 failures are pre-existing
  (identical names + count on clean `main` baseline; environment/worktree-driven). Zero new failures.
- All 7 edited modules `require()` cleanly; `gx --help` exits 0.
- Independent reviewer pass: NO BLOCKING FINDINGS.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/phase1-remove-dead-code-and-frontend-cru-2026-06-03-10-31 --base main --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
