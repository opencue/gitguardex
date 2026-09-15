# agent-claude-infer-pr-base-from-git-history-2026-09-15-08-58 (fix / T2)

Branch: `agent/claude/infer-pr-base-from-git-history-2026-09-15-08-58`

When an agent branch has no `branch.<b>.guardexBase` (e.g., created via raw
`git worktree add` instead of `gx agent branch start`), the finish hooks
previously fell back blindly to `multiagent.baseBranch`, which could be stale.
In the incident that motivated this fix, `multiagent.baseBranch=ksskkfb02`
while the branch had actually forked from `ksskkfb03`, causing the PR to
target the wrong base.

## Resolution strategy

1. **Reflog hint** — parse `git reflog show --no-abbrev <source>` for the
   oldest "branch: Created from <name>" entry. If the name is a valid local or
   remote-tracking branch (and is not HEAD, a raw SHA, or self), return it
   immediately.
2. **Ancestry distance** — build a candidate set (configured base, protected
   branches, detected default, all local non-agent branches) and pick the one
   with the smallest `git rev-list --count <merge-base>..<source>`.
3. **Tie-break** — prefer `multiagent.baseBranch` > protected-branches order >
   lexical; emit a one-line WARNING to stderr.
4. **Fallback** — if no candidate yields a merge-base, fall through to the
   existing `multiagent.baseBranch` → `detectDefaultBaseBranch` chain.
5. **Persist** — write the inferred result to `branch.<b>.guardexBase` in the
   finish path so every subsequent gate agrees; the inspect path infers but
   does NOT persist (read-only display).

## Files changed

- `src/git/index.js` — `inferBaseBranchFromHistory()` new function + updated
  `resolveFinishBaseBranch` to call it when `guardexBase` is absent.
- `src/agents/inspect.js` — `resolveBaseBranch` calls `inferBaseBranchFromHistory`
  (no persist) before falling back to the repo-wide config.
- `templates/scripts/lib/guardex-base-branch.sh` — new shared bash helper
  exposing `guardex_infer_base_branch <repo_root> <source_branch>`.
- `scripts/lib/guardex-base-branch.sh` — symlink into templates.
- `scripts/check-script-symlinks.sh` — registers the new symlink.
- `templates/scripts/agent-branch-finish.sh` — sources lib; uses
  `guardex_infer_base_branch` in the base-resolution block.
- `templates/scripts/agent-claude-stop-finish.sh` — sources lib; uses
  `guardex_infer_base_branch` in `resolve_base_branch`.
- `templates/scripts/agent-branch-merge.sh` — sources lib; uses
  `guardex_infer_base_branch` in `resolve_base_branch`.
- `templates/scripts/codex-agent.sh` — sources lib; uses
  `guardex_infer_base_branch` in `resolve_worktree_base_branch`.
- `test/git-base-branch.test.js` — 5 new test cases covering reflog hint,
  ancestry fallback, null when branch absent, finish persist, explicit/preset wins.
- `test/agents-inspect.test.js` — 1 new test: infer without persist.
- `README.md` — base-resolution paragraph updated.
