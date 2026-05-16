## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-codex-clear-agent-upstream-on-branch-start-2026-04-20-20-06`.
- [x] 1.2 Define normative requirements in `specs/agent-branch-upstream-tracking/spec.md`.

## 2. Implementation

- [x] 2.1 Implement scoped behavior changes.
- [x] 2.2 Add/update focused regression coverage.

## 3. Verification

- [x] 3.1 Run targeted project verification commands.
- [x] 3.2 Run `openspec validate agent-codex-clear-agent-upstream-on-branch-start-2026-04-20-20-06 --type change --strict`.
- [x] 3.3 Run `openspec validate --specs`.

## 4. Completion

- [x] 4.1 Finish the agent branch via PR merge + cleanup (`gx finish --via-pr --wait-for-merge --cleanup` or `bash scripts/agent-branch-finish.sh --branch <agent-branch> --base <base-branch> --via-pr --wait-for-merge --cleanup`).
- [x] 4.2 Record PR URL + final `MERGED` state in the completion handoff.
- [x] 4.3 Confirm sandbox cleanup (`git worktree list`, `git branch -a`) or capture a `BLOCKED:` handoff if merge/cleanup is pending.
