## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-claude-verify-self-update-actually-advanced-ver-2026-04-20-10-01` (see `proposal.md`).
- [x] 1.2 Define normative requirements in `specs/verify-self-update-actually-advanced-version/spec.md` — 4 scenarios covering stale `@latest`, failed pinned retry, unresolvable `npm root -g`, and the happy path.

## 2. Implementation

- [x] 2.1 Add `readInstalledGuardexVersion()` helper in `bin/multiagent-safety.js` that resolves the global install via `npm root -g` + fs read and returns `null` when unresolvable.
- [x] 2.2 Extend `maybeSelfUpdateBeforeStatus` to verify the on-disk version after `npm i -g <pkg>@latest` and run a pinned retry (`npm i -g <pkg>@<latest>`) when the install is idempotent.
- [x] 2.3 Emit actionable diagnostic (`npm root -g && npm cache verify`) when both the `@latest` install and the pinned retry leave the on-disk version stale; do NOT print "Updated to latest published version" in that case.
- [x] 2.4 Add regression test `self-update verifies on-disk version after @latest install and retries with pinned version when stale` in `test/install.test.js`; fake npm stubs `view` / `list` / `root -g` / `i -g @latest` (stays stale) / `i -g @9.9.9` (advances on disk).
- [x] 2.5 Bump `package.json` version `7.0.5` → `7.0.6`.
- [x] 2.6 Add `### v7.0.6` release note to `README.md` documenting the fix and the diagnostic hint.

## 3. Verification

- [x] 3.1 `node --check bin/multiagent-safety.js` — JS syntax OK.
- [x] 3.2 `node --test --test-name-pattern="self-update" test/install.test.js` — 2/2 pass (new retry test + existing prompt-strict test).
- [x] 3.3 `node --test --test-name-pattern="default invocation checks for update|latest install" test/install.test.js` — 2/2 pass (pre-existing update path and the new retry test both behave correctly; the existing test's fake npm doesn't stub `root -g`, so the verification path is skipped and pre-existing behavior is preserved).
- [x] 3.4 `openspec validate agent-claude-verify-self-update-actually-advanced-ver-2026-04-20-10-01 --type change --strict` — valid.

## 4. Cleanup

- [x] 4.1 Run `scripts/agent-branch-finish.sh --branch agent/claude/verify-self-update-actually-advanced-ver-2026-04-20-10-01 --base main --via-pr --wait-for-merge --cleanup`.
- [x] 4.2 Record PR URL + `MERGED` state and confirm sandbox worktree removed.
- [x] 4.3 User runs `npm publish` to cut 7.0.6 to npm, then `npm i -g @imdeadpool/guardex@7.0.6` (pinned, because the self-update-via-@latest bug only fixes itself ONCE this version is installed).
