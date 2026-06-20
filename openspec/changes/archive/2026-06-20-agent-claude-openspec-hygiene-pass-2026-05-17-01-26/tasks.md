## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**.

## Handoff

- Handoff: change=`agent-claude-openspec-hygiene-pass-2026-05-17-01-26`; branch=`agent/claude/openspec-hygiene-pass-2026-05-17-01-26`; scope=`archive 221 active OpenSpec changes whose PRs already merged + tick cleanup boxes`; action=`finish via PR + cleanup`.

## 1. Specification

- [x] 1.1 Confirm scope: archive only changes with verifiable merge evidence (exact branch match against merged PRs, or commits inside the change dir on `origin/main`).
- [x] 1.2 Record approach + impact in `proposal.md`; keep the change-level spec as a placeholder since the operation is workspace hygiene, not capability behavior.

## 2. Implementation

- [x] 2.1 Fetch all merged PRs via `gh pr list --state merged --limit 600 --search "base:main" --json number,mergedAt,headRefName,title`.
- [x] 2.2 Classify each active change in `openspec/changes/` by exact-branch PR lookup, loose trimmed-slug substring match (uniqueness-guarded, length >= 15), and commits-on-`origin/main`.
- [x] 2.3 For each `DONE_*` classification, flip unchecked boxes in `## 4./5./6.` and `## Cleanup` sections of `tasks.md` / `notes.md` (sections 1-3 already checked by their original authors).
- [x] 2.4 Run `openspec archive <slug> --yes`, falling back to `--yes --skip-specs` when delta specs collide with already-applied main-spec entries.

## 3. Verification

- [x] 3.1 `openspec validate --specs` -> 133 passed, 0 failed.
- [x] 3.2 `git diff --stat openspec/specs/` shows only additive delta-spec merges from the archive pipeline (no manual rewrites).
- [x] 3.3 Spot-check 5 random archived changes confirms their PRs merged and the change is now under `openspec/changes/archive/2026-05-16-*`.

## 4. Cleanup (mandatory; run before claiming completion)

- [ ] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/claude/openspec-hygiene-pass-2026-05-17-01-26 --base main --via-pr --wait-for-merge --cleanup`.
- [ ] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [ ] 4.3 Confirm the sandbox worktree is gone (`git worktree list`).
