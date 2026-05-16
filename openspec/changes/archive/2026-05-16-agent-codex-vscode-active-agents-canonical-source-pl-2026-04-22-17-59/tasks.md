## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-codex-vscode-active-agents-canonical-source-pl-2026-04-22-17-59`; branch=`agent/codex/continue-vscode-extension-collab-plan-2026-04-22-17-59`; scope=`planning artifacts for the Active Agents canonical-source migration: stale-note audit, setup/doctor asset propagation, execution lanes, and focused proof surface`; action=`finish the planning lane now, then spin a fresh implementation branch from main for the actual source-tree migration`.
- Copy prompt: Continue `agent-codex-vscode-active-agents-canonical-source-pl-2026-04-22-17-59` on branch `agent/codex/continue-vscode-extension-collab-plan-2026-04-22-17-59`. Work inside the existing sandbox, review the change tasks plus `openspec/plan/agent-codex-vscode-active-agents-canonical-source-pl-2026-04-22-17-59/`, keep the plan branch limited to artifacts/review evidence, and create a fresh implementation branch from `main` before touching runtime/setup code.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-codex-vscode-active-agents-canonical-source-pl-2026-04-22-17-59`.
- [x] 1.2 Define normative requirements in `specs/vscode-active-agents-extension/spec.md`.

## 2. Planning

- [x] 2.1 Create an execution-ready plan workspace under `openspec/plan/agent-codex-vscode-active-agents-canonical-source-pl-2026-04-22-17-59/`.
- [x] 2.2 Resolve the stale follow-up notes against current `main` and capture the real remaining issue: duplicate authored extension sources plus template-asset propagation risk.
- [x] 2.3 Publish planner/architect/critic checkpoints, execution lanes, and proof surfaces for the canonical-source migration.

## 3. Verification

- [x] 3.1 Run `openspec validate agent-codex-vscode-active-agents-canonical-source-pl-2026-04-22-17-59 --type change --strict`.
- [x] 3.2 Confirm `summary.md`, `phases.md`, `checkpoints.md`, and role `tasks.md` files describe the same canonical-source scope and keep runtime/UI work out of scope.
- [x] 3.3 Record the planning validation evidence in the root completion handoff.

Verification note: `openspec validate agent-codex-vscode-active-agents-canonical-source-pl-2026-04-22-17-59 --type change --strict` passed on the planning branch after the summary, phases, checkpoints, and role task boards were aligned around the canonical-source scope.

## 4. Cleanup (mandatory; run before claiming completion)

- [x] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/codex/continue-vscode-extension-collab-plan-2026-04-22-17-59 --base main --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
