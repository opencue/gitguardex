# agent-claude-smoother-finish-autoclaim-deletes-and-lo-2026-05-12-00-28 (minimal / T1)

Branch: `agent/claude/smoother-finish-autoclaim-deletes-and-lo-2026-05-12-00-28` against `main`.

Two surgical ergonomic fixes to remove recurring friction in the agent commit + finish flow:

1. `templates/githooks/pre-commit`: the existing `GUARDEX_AUTOCLAIM_STAGED_LOCKS` block iterates `--diff-filter=ACMRDTUXB` and calls `locks claim --branch ... <file>` without `--allow-delete`. The next step (`locks validate --staged`) then rejects the deletion because its `allow_delete` flag is False, forcing the operator to run `gx locks allow-delete` and re-commit. The fix splits non-deletion paths from deletions, claims deletions with `--allow-delete`, and gates the new behavior behind `GUARDEX_AUTOCLAIM_STAGED_DELETES` (default `1`, opt-out only).

2. `templates/scripts/agent-branch-finish.sh` `run_pr_flow`: `gh pr create` was wrapped in `>/dev/null 2>&1 || true`, so when it fails (auth, branch protection, gh version skew), the failure was invisible. The function then proceeded to `gh pr view` (empty URL) and `gh pr merge` (silent no-op), leaving operators with a "merged via pr flow" log line and no PR. The fix captures stderr, allows the idempotent "PR already exists" path through silently, surfaces every other failure verbatim, and fails the function fast when `pr_view` returns no URL.

Both changes are additive and behind opt-out env vars where behavior diverges; existing operators see strictly fewer reject + retry loops and louder PR-create failures.

## Handoff

- Handoff: change=`agent-claude-smoother-finish-autoclaim-deletes-and-lo-2026-05-12-00-28`; branch=`agent/<your-name>/<branch-slug>`; scope=`TODO`; action=`continue this sandbox or finish cleanup after a usage-limit/manual takeover`.
- Copy prompt: Continue `agent-claude-smoother-finish-autoclaim-deletes-and-lo-2026-05-12-00-28` on branch `agent/<your-name>/<branch-slug>`. Work inside the existing sandbox, review `openspec/changes/agent-claude-smoother-finish-autoclaim-deletes-and-lo-2026-05-12-00-28/notes.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`.

## Cleanup

- [x] Run: `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`
- [x] Record PR URL + `MERGED` state in the completion handoff.
- [x] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
