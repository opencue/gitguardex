## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `auto-release-writer`.
- [x] 1.2 Define normative requirements in `specs/release-workflow/spec.md`.

## 2. Implementation

- [x] 2.1 Replace the maintainer `gx release` path so it generates GitHub release notes from README history and creates or updates the public GitHub release instead of running `npm publish` directly.
- [x] 2.2 Add focused regression coverage for README aggregation, package-manifest repo targeting, and create-vs-edit GitHub release behavior.
- [x] 2.3 Update operator-facing docs for the new release flow and rewrite the live `v7.0.15` GitHub release body with the generated notes.

## 3. Verification

- [ ] 3.1 Run targeted project verification commands (`node --test test/install.test.js test/metadata.test.js`, `node --check bin/multiagent-safety.js`).
- [x] 3.2 Run `openspec validate auto-release-writer --type change --strict`.
- [x] 3.3 Run `openspec validate --specs`.

Verification note: `node --check bin/multiagent-safety.js` passed. The exact `node --test test/install.test.js test/metadata.test.js` command still timed out after 120s because unrelated `setup`/`doctor` areas in `test/install.test.js` are red in this repo baseline, while the release-focused slice and the inherited `codex-agent` regressions touched here now pass.

## 4. Completion

- [x] 4.1 Finish the agent branch via PR merge + cleanup (`gx finish --via-pr --wait-for-merge --cleanup` or `bash scripts/agent-branch-finish.sh --branch <agent-branch> --base <base-branch> --via-pr --wait-for-merge --cleanup`).
- [x] 4.2 Record PR URL + final `MERGED` state in the completion handoff.
- [x] 4.3 Confirm sandbox cleanup (`git worktree list`, `git branch -a`) or capture a `BLOCKED:` handoff if merge/cleanup is pending.

Completion evidence:
- PR: `#224` <https://github.com/recodeee/gitguardex/pull/224>
- Final state: `MERGED` into `main` at `2026-04-21T11:55:12Z`
- Merge/cleanup path: `bash scripts/agent-branch-finish.sh --branch "agent/codex/auto-release-writer-2026-04-21-13-20" --base main --via-pr --wait-for-merge --cleanup`
- Cleanup confirmation: sandbox worktree `/home/deadpool/Documents/recodee/gitguardex/.omx/agent-worktrees/agent__codex__auto-release-writer-2026-04-21-13-20` is gone; `git branch -a | rg "auto-release-writer|main$|origin/main"` shows only `main` and `origin/main`
- Follow-up note: the finish script hit a final remote-delete error after GitHub had already removed the merged branch ref, so `git remote prune origin` was used to clear the stale tracking ref locally
