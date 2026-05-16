## Definition of Done

This change is complete only when all of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks, add a `BLOCKED:` line under section 4 and stop.

## Handoff

- Handoff: change=`agent-codex-dedupe-cli-main-context-output-scaffold-2026-04-22-14-29`; branch=`agent/codex/dedupe-cli-main-context-output-scaffold-2026-04-22-14-29`; scope=`src/cli/main.js`, `src/context.js`, `src/output/index.js`, `src/scaffold/index.js`, `test/cli-args-dispatch.test.js`; action=`delete remaining shared-helper duplication from src/cli/main.js and keep context/output/scaffold as the only live source of truth`.

## 1. Specification

- [x] 1.1 Capture the mechanical cleanup scope and acceptance criteria for the remaining shared helper duplication.
- [x] 1.2 Add a `cli-modularization` spec delta covering context/output/scaffold single-source ownership and the known drift cases.

## 2. Implementation

- [x] 2.1 Add focused regression coverage for shared-source ownership and the known drift cases before editing the cleanup targets.
- [x] 2.2 Move duplicated constants/session helpers in `src/cli/main.js` to `src/context.js` imports and reconcile `MANAGED_GITIGNORE_PATHS`.
- [x] 2.3 Move duplicated presentation helpers in `src/cli/main.js` to `src/output/index.js` imports.
- [x] 2.4 Move duplicated scaffold/file-install helpers in `src/cli/main.js` to `src/scaffold/index.js` imports and make scaffold reuse `context`'s `toDestinationPath`.
- [x] 2.5 Remove dead or duplicate helpers from `src/cli/main.js` (`installMany`, `initWorkspace`, `doctorAudit`, `syncDoctorLocalSupportFiles`, `promptYesNo`, `envFlagEnabled`, one `gitRefExists`, and the duplicate auto-finish failure log).

## 3. Verification

- [x] 3.1 Run `node --check src/cli/main.js src/context.js src/output/index.js src/scaffold/index.js`.
- [x] 3.2 Run `node --test test/cli-args-dispatch.test.js`.
- [x] 3.3 Run focused CLI regression suites that cover setup/doctor/install surfaces touched by the cleanup.
- [x] 3.4 Run `openspec validate agent-codex-dedupe-cli-main-context-output-scaffold-2026-04-22-14-29 --type change --strict`.
- [x] 3.5 Run `openspec validate --specs`.

Verification note: `node --check src/cli/main.js src/context.js src/output/index.js src/scaffold/index.js`, `node --test test/cli-args-dispatch.test.js`, `node --test test/cli-args-dispatch.test.js test/setup.test.js test/doctor.test.js test/install.test.js test/metadata.test.js`, and `npm test` all passed after the cleanup. `openspec validate agent-codex-dedupe-cli-main-context-output-scaffold-2026-04-22-14-29 --type change --strict` exited `0`, and `openspec validate --specs` exited `0` with `No items found to validate`.

## 4. Cleanup

- [x] 4.1 Run `gx branch finish --branch agent/codex/dedupe-cli-main-context-output-scaffold-2026-04-22-14-29 --base main --via-pr --wait-for-merge --cleanup`.
- [x] 4.2 Record PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm the sandbox worktree is removed and no local/remote refs remain for the branch.
