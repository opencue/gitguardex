## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## 1. Specification

- [x] 1.1 Capture the synthetic session URI and idle-decoration rules in branch-local OpenSpec artifacts.

## 2. Implementation

- [x] 2.1 Add a session decoration provider keyed by `gitguardex-agent://<sanitized-branch>` URIs and assign `resourceUri` on `SessionItem`.
- [x] 2.2 Fire decoration refreshes from the Active Agents refresh path and register the provider in `activate()`.
- [x] 2.3 Mirror the extension change into `templates/vscode/guardex-active-agents/extension.js`.
- [x] 2.4 Add or update focused regression coverage for the idle-decoration behavior.

## 3. Verification

- [x] 3.1 Run `node --test test/vscode-active-agents-session-state.test.js`.
- [x] 3.2 Run `openspec validate agent-codex-vscode-tree-lock-decorations-2026-04-22-10-55 --type change --strict`.

## 4. Cleanup (mandatory; run before claiming completion)

- [x] 4.1 Run the cleanup pipeline: `bash scripts/agent-branch-finish.sh --branch agent/codex/vscode-tree-lock-decorations-2026-04-22-10-55 --base main --via-pr --wait-for-merge --cleanup`.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
