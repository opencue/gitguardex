## Handoff

- Handoff: change=`agent-codex-release-guardex-7-0-25-2026-04-23-12-33`; branch=`agent/codex/release-guardex-7-0-25-2026-04-23-12-33`; scope=`package.json`, `package-lock.json`, `README.md`, `vscode/guardex-active-agents/package.json`, `templates/vscode/guardex-active-agents/package.json`; action=`bump Guardex to v7.0.25, bump the bundled Active Agents companion to 0.0.9, and cut a release that explicitly calls out the VS Code extension surface`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-codex-release-guardex-7-0-25-2026-04-23-12-33`.
- [x] 1.2 Define normative requirements in `specs/release-version-bump/spec.md`.

## 2. Implementation

- [x] 2.1 Bump `package.json`, `package-lock.json`, `README.md`, and the live/template Active Agents companion manifests to the next publishable release versions.
- [x] 2.2 Keep the release scoped to metadata and packaged companion versioning only; no new Guardex runtime behavior is introduced in this lane.

## 3. Verification

- [x] 3.1 Run `npm test`. The full suite passed in this lane with `249` tests, `248` passes, `1` skip, and `0` failures.
- [x] 3.2 Run `node --check bin/multiagent-safety.js` and `npm pack --dry-run`. Both passed, and `npm pack --dry-run` produced `imdeadpool-guardex-7.0.25.tgz`.
- [x] 3.3 Run `openspec validate agent-codex-release-guardex-7-0-25-2026-04-23-12-33 --type change --strict` and `openspec validate --specs`. The change validated cleanly, and repo-level spec validation exited clean with `No items found to validate.`

## 4. Cleanup

- [x] 4.1 Run `gx branch finish --branch agent/codex/release-guardex-7-0-25-2026-04-23-12-33 --base main --via-pr --wait-for-merge --cleanup`.
- [x] 4.2 Record PR URL + final `MERGED` state in the completion handoff.
- [x] 4.3 Confirm sandbox cleanup with `git worktree list` and `git branch -a`.
