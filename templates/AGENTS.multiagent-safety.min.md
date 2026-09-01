<!-- multiagent-safety:START -->
## Multi-Agent Safety (minimal)

Guardex is enabled by default. Disable via repo-root `.env` with `GUARDEX_ON=0`.
Worktrees default to strict `always` mode. Repositories that prefer a faster
single-agent path may opt in with `GUARDEX_WORKTREE_MODE=adaptive` in `.env` (or
`git config --local multiagent.worktreeMode adaptive`).

- In adaptive mode, small single-agent work may stay on the current checkout only after `gx status`, `gx mcp list-agents --no-prs`, and `gx mcp who-owns <file>` show no competing writer or target-file ownership.
- Direct protected-main shell work is limited to `git add`/ordinary commit/push and bounded test/lint/build commands; custom executors or history rewrites use an isolated lane.
- Pivot to an isolated lane when the task is substantial/long-lived, another writer is active in the repo, a target path is dirty or owned elsewhere, or scope expands. Use `gx branch start --new --no-transfer "<task>" "<agent-name>"`, then `cd` into the printed worktree.
- In strict `always` mode, work from an `agent/*` branch + worktree and never edit the protected base (`main`/`dev`) directly.
- In an isolated lane, claim files before editing: `gx locks claim --branch "<agent-branch>" <file...>`.
- Use CodeGraph first for repository symbol, relationship, architecture, and impact lookup. If the project is not initialized, run `codegraph init -i` once and retry.
- Use `opensrc path <package-or-owner/repo[@ref|#ref]>` before generic clone/download when inspecting dependency or external repository source.
- Finish isolated work via PR + cleanup: `gx branch finish --branch "<agent-branch>" --via-pr --wait-for-merge --cleanup` (or `gx finish --all`). Direct adaptive work uses the repository's ordinary commit/push flow.
- For isolated lanes, default to the self-repairing gated ship — add `--gate-review --gate-autofix` so blocking findings are fixed and re-verified before the merge instead of leaving the PR open. Add `--gate-baseline` only where the base branch CI is already red. CI waits until the review is clean by default; `--no-gate-serial-ci` opts into overlap. Codex code-assist defaults to bounded `medium` effort (override with `GUARDEX_REVIEW_CODEX_EFFORT`). Posting a review is not merging: `gx pr-review` posts and exits; only `gx branch finish` merges.

Want the full multi-agent contract (Colony coordination, OpenSpec, token discipline, recovery)? Run `gx setup --contract`.
<!-- multiagent-safety:END -->
