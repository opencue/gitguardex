## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-codex-release-guardex-7-0-22-2026-04-22-16-19`.
- [x] 1.2 Define normative requirements in `specs/release-version-bump/spec.md`.

## 2. Implementation

- [x] 2.1 Bump `package.json`, `package-lock.json`, and `README.md` to the next publishable Guardex release version.
- [x] 2.2 Keep the release scoped to metadata only; no runtime payload changes are introduced in this lane.

## 3. Verification

- [x] 3.1 Run `node --test test/metadata.test.js`, `node --check bin/multiagent-safety.js`, and `npm pack --dry-run` for the release-only change. All three passed in `/tmp/gitguardex-release-7-0-22`; metadata finished with `18/18` passing tests, and `npm pack --dry-run` produced `imdeadpool-guardex-7.0.22.tgz`.
- [x] 3.2 Run `openspec validate agent-codex-release-guardex-7-0-22-2026-04-22-16-19 --type change --strict`.
- [x] 3.3 Run `openspec validate --specs`. Current repo baseline reports `No items found to validate.` and exits clean.

## 4. Cleanup

- [x] 4.1 Run: `gx branch finish --branch agent/codex/release-guardex-7-0-22-2026-04-22-16-19 --base main --via-pr --wait-for-merge --cleanup`
- [x] 4.2 Record PR URL + `MERGED` state in the completion handoff.
- [x] 4.3 Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
