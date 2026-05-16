## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-codex-vscode-active-agents-extension-2026-04-21-17-38`.
- [x] 1.2 Define normative requirements in `specs/vscode-active-agents-extension/spec.md`.

## 2. Implementation

- [x] 2.1 Add repo-local active-session state writing/cleanup around `scripts/codex-agent.sh`.
- [x] 2.2 Add the VS Code Source Control companion view and local install path.
- [x] 2.3 Add/update focused regression coverage for session-state parsing and install behavior.
- [x] 2.4 Update README guidance for the real VS Code companion flow.

## 3. Verification

- [x] 3.1 Run targeted project verification commands for the session-state helper, extension sources, and install path.
- [x] 3.2 Run `openspec validate agent-codex-vscode-active-agents-extension-2026-04-21-17-38 --type change --strict`.
- [x] 3.3 Run `openspec validate --specs`.

## 4. Cleanup (mandatory; run before claiming completion)

- [x] 4.1 Run the cleanup pipeline: `bash scripts/agent-branch-finish.sh --branch agent/<your-name>/<branch-slug> --base main --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
