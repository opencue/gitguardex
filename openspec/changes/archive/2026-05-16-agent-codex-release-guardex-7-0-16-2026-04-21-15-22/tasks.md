## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-codex-release-guardex-7-0-16-2026-04-21-15-22`.
- [x] 1.2 Define normative requirements in `specs/release-version-bump/spec.md`.

## 2. Implementation

- [x] 2.1 Bump `package.json`, `package-lock.json`, and `README.md` to the next publishable Guardex release version.
- [x] 2.2 Update the `gx release` integration expectation in `test/install.test.js` so the release workflow follows the current package version.

## 3. Verification

- [x] 3.1 Run `npm test`, `node --check bin/multiagent-safety.js`, and `npm pack --dry-run` for the release-only change. `npm test` passed `150/150`; `node --check bin/multiagent-safety.js` passed; `npm pack --dry-run` produced `imdeadpool-guardex-7.0.16.tgz`.
- [x] 3.2 Run `openspec validate agent-codex-release-guardex-7-0-16-2026-04-21-15-22 --type change --strict`. Result: `Change 'agent-codex-release-guardex-7-0-16-2026-04-21-15-22' is valid`.
- [x] 3.3 Run `openspec validate --specs`. Result: `No items found to validate.`

## 4. Completion

- [x] 4.1 Finish the agent branch via PR merge + cleanup (`gx finish --via-pr --wait-for-merge --cleanup` or `bash scripts/agent-branch-finish.sh --branch <agent-branch> --base <base-branch> --via-pr --wait-for-merge --cleanup`).
- [x] 4.2 Record PR URL + final `MERGED` state in the completion handoff.
- [x] 4.3 Confirm sandbox cleanup (`git worktree list`, `git branch -a`) or capture a `BLOCKED:` handoff if merge/cleanup is pending.
