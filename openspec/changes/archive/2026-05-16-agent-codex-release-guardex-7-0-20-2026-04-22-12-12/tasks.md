## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-codex-release-guardex-7-0-20-2026-04-22-12-12`.
- [x] 1.2 Define normative requirements in `specs/release-version-bump/spec.md`.

## 2. Implementation

- [x] 2.1 Bump `package.json`, `package-lock.json`, and `README.md` to the next publishable Guardex release version.
- [x] 2.2 No new runtime regression coverage is required because this change only updates release metadata for already-merged behavior.

## 3. Verification

- [x] 3.1 Run `npm test`, `node --check bin/multiagent-safety.js`, and `npm pack --dry-run` for the release-only change. All three passed in `/tmp/gitguardex-release-7-0-20`; `npm test` finished with 187 tests, 185 passes, 0 failures, and 2 skips.
- [x] 3.2 Run `openspec validate agent-codex-release-guardex-7-0-20-2026-04-22-12-12 --type change --strict`.
- [x] 3.3 Run `openspec validate --specs`. Current repo baseline reports `No items found to validate.` and exits clean.

## 4. Completion

- [x] 4.1 Finish the agent branch via PR merge + cleanup (`gx branch finish --branch "agent/codex/release-guardex-7-0-20-2026-04-22-12-12" --base main --via-pr --wait-for-merge --cleanup`).
- [x] 4.2 Run `gx release` from the maintainer repo after merge and record the GitHub release URL plus npm workflow result.
- [x] 4.3 Record PR URL + final `MERGED` state in the completion handoff.
- [x] 4.4 Confirm sandbox cleanup (`git worktree list`, `git branch -a`) or capture a `BLOCKED:` handoff if merge, release, or cleanup is still pending.
