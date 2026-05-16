## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-claude-dedupe-hooks-soften-skill-guard-2026-05-17-00-35`; branch=`agent/<your-name>/<branch-slug>`; scope=`TODO`; action=`continue this sandbox or finish cleanup after a usage-limit/manual takeover`.
- Copy prompt: Continue `agent-claude-dedupe-hooks-soften-skill-guard-2026-05-17-00-35` on branch `agent/<your-name>/<branch-slug>`. Work inside the existing sandbox, review `openspec/changes/agent-claude-dedupe-hooks-soften-skill-guard-2026-05-17-00-35/tasks.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-claude-dedupe-hooks-soften-skill-guard-2026-05-17-00-35`.
- [x] 1.2 Define normative requirements in `specs/dedupe-hooks-soften-skill-guard/spec.md`.

## 2. Implementation

- [x] 2.1 Symlink `.codex/hooks/*.py` to canonical `.claude/hooks/*.py` and document in `HOOKS.md`.
- [x] 2.2 Add `GUARDEX_AGENT_BRANCH_PREFIXES` env var and `is_agent_branch()` helper in `skill_guard.py`; extend read-only allowlist for version probes.
- [x] 2.3 Add `test/skill-guard-hook.test.js` covering allow/block matrix and env override.

## 3. Verification

- [x] 3.1 `node --test test/skill-guard-hook.test.js` (9/9 pass).
- [x] 3.2 `npm test` shows no regressions vs main baseline (22 pre-existing failures, unchanged set).

## 4. Cleanup (mandatory; run before claiming completion)

- [ ] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [ ] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [ ] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
