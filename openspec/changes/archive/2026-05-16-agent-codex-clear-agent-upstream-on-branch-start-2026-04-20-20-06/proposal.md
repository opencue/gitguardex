## Why

- Fresh `agent/*` worktrees inherit `origin/<base>` as their upstream when they are created from a protected branch.
- That makes unpublished sandbox branches look divergent from `main`/`dev`, and VS Code `Sync Changes` tries to pull the protected base branch instead of waiting for the first `git push -u`.

## What Changes

- Update `scripts/agent-branch-start.sh` and its template so new agent branches start without any upstream tracking, while still storing `branch.<name>.guardexBase`.
- Mirror the same no-upstream rule in the `scripts/codex-agent.sh` fallback starter so legacy or recovery paths cannot reintroduce the bug.
- Lock the behavior with focused install regressions and document that fresh sandbox branches are intentionally unpublished until the first push.

## Impact

- Affects branch/worktree bootstrap only; publish behavior remains unchanged because the first `git push -u` still establishes the real upstream branch.
- Low rollout risk because `agent-branch-finish` already reads `guardexBase` metadata instead of relying on branch upstream config.
- Owned scope for this change: branch-start bootstrap, codex-agent fallback bootstrap, install regressions, and README startup guidance.
