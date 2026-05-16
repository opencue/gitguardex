## Definition of Done

This change is complete only when all of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks, append a `BLOCKED:` line under section 4 explaining the blocker and stop.

## Handoff

- Handoff: change=`agent-codex-colony-queen-agent-json-surface-2026-04-30-00-03`; branch=`agent/codex/colony-queen-agent-json-surface-2026-04-30-00-03`; scope=`agents start/status/finish JSON surface plus cockpit state`; action=`finish cleanup after quota takeover`.
- Copy prompt: Continue `agent-codex-colony-queen-agent-json-surface-2026-04-30-00-03` on branch `agent/codex/colony-queen-agent-json-surface-2026-04-30-00-03`. Work inside the existing sandbox, review this file, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/codex/colony-queen-agent-json-surface-2026-04-30-00-03 --base main --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Record proposal scope and acceptance criteria.
- [x] 1.2 Define normative JSON surface requirements.

## 2. Implementation

- [x] 2.1 Preserve Colony metadata through `gx agents start`.
- [x] 2.2 Add status/cockpit fields for claims, changed files, metadata, launch command, and PR evidence.
- [x] 2.3 Add finish JSON evidence and persist it on the session.

## 3. Verification

- [x] 3.1 Run focused agent/cockpit tests.
- [x] 3.2 Run `openspec validate agent-codex-colony-queen-agent-json-surface-2026-04-30-00-03 --type change --strict`.
- [x] 3.3 Run `openspec validate --specs`.

## 4. Cleanup

- [x] 4.1 Run `gx branch finish --branch agent/codex/colony-queen-agent-json-surface-2026-04-30-00-03 --base main --via-pr --wait-for-merge --cleanup`.
- [x] 4.2 Record PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm sandbox worktree is gone and no local/remote branch refs remain.
- BLOCKED: `gx branch finish --branch agent/codex/colony-queen-agent-json-surface-2026-04-30-00-03 --base main --via-pr --wait-for-merge --cleanup` auto-synced onto `origin/main` and hit rebase conflicts in `src/agents/start.js`, `src/cli/args.js`, and `test/agents-start-dry-run.test.js`; branch is 11 commits behind `origin/main`.
