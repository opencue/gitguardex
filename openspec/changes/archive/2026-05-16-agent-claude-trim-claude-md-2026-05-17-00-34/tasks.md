## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-claude-trim-claude-md-2026-05-17-00-34`; branch=`agent/claude/trim-claude-md-2026-05-17-00-34`; scope=`trim AGENTS.md to a lean contract; move verbose sections to .agent/*.md subdocs; preserve marker + symlink`; action=`finish via PR + wait + cleanup`.
- Copy prompt: Continue `agent-claude-trim-claude-md-2026-05-17-00-34` on branch `agent/claude/trim-claude-md-2026-05-17-00-34`. Work inside the existing sandbox, review `openspec/changes/agent-claude-trim-claude-md-2026-05-17-00-34/tasks.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/claude/trim-claude-md-2026-05-17-00-34 --base main --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-claude-trim-claude-md-2026-05-17-00-34`.
- [x] 1.2 Define normative requirements in `specs/trim-claude-md/spec.md`.

## 2. Implementation

- [x] 2.1 Trim `AGENTS.md` editable portion; move verbose sections verbatim into `.agent/TOKEN-DISCIPLINE.md`, `.agent/GUARDEX-TOGGLE.md`, `.agent/CLAUDE-CODE-WORKFLOW.md`, `.agent/OPENSPEC-WORKFLOW.md`, `.agent/MULTI-AGENT-CONTRACT.md`, `.agent/PLAN-WORKSPACE.md`, `.agent/STALLED-WORKTREE-RECOVERY.md`. Preserve the marker-managed `multiagent-safety` block and the `SPECKIT` block byte-identical to `main`. Keep `CLAUDE.md` as a symlink to `AGENTS.md`.
- [x] 2.2 Doc-only change; regression evidence is `diff` of marker block vs. `main` (empty) + `readlink CLAUDE.md == AGENTS.md` + `wc -l AGENTS.md` under 600.

## 3. Verification

- [x] 3.1 `readlink CLAUDE.md` → `AGENTS.md`; `wc -l AGENTS.md` → 545 (target < 600); `diff` of marker + SPECKIT blocks vs. `main` is empty.
- [x] 3.2 Run `openspec validate agent-claude-trim-claude-md-2026-05-17-00-34 --type change --strict`.
- [x] 3.3 Run `openspec validate --specs`.

## 4. Cleanup (mandatory; run before claiming completion)

- [x] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/claude/trim-claude-md-2026-05-17-00-34 --base main --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
