<!-- multiagent-safety:START -->
## Multi-Agent Safety (minimal)

Guardex is enabled by default. Disable via repo-root `.env` with `GUARDEX_ON=0`.

- Work from an `agent/*` branch + worktree — never edit the protected base (`main`/`dev`) directly. Start with `gx branch start "<task>" "<agent-name>"`, then `cd` into the printed worktree.
- Claim files before editing: `gx locks claim --branch "<agent-branch>" <file...>`.
- Finish completed work via PR + cleanup: `gx branch finish --branch "<agent-branch>" --via-pr --wait-for-merge --cleanup` (or `gx finish --all`).
- Default to the self-repairing gated ship — add `--gate-review --gate-autofix` so blocking findings are fixed and re-verified before the merge instead of leaving the PR open. Add `--gate-baseline` only where the base branch CI is already red. CI waits until the review is clean by default; `--no-gate-serial-ci` opts into overlap. Codex code-assist defaults to bounded `medium` effort (override with `GUARDEX_REVIEW_CODEX_EFFORT`). Posting a review is not merging: `gx pr-review` posts and exits; only `gx branch finish` merges.

Want the full multi-agent contract (Colony coordination, OpenSpec, token discipline, recovery)? Run `gx setup --contract`.
<!-- multiagent-safety:END -->
