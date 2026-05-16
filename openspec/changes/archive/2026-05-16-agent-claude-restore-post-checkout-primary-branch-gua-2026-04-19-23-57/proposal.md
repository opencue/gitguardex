## Why

v6.1.0 introduced a `post-checkout` git hook that enforced primary-checkout
immutability — nested repos (e.g. `guardex-agent-work-tree-managment` inside
`recodee`) couldn't be silently switched off their protected base branch.
PR #142 merged it, but the follow-up `v7.0.0` CLI consolidation landed via a
parallel branch that did not carry the hook forward. Today `main` has no
`post-checkout` hook and `templates/githooks/post-checkout` is missing
entirely — a regression confirmed by the reflog of a nested guardex
checkout that was mutated from `main` → `chore/sync-agents-config-from-recodee`
during a recent sync session.

## What Changes

Restore the v6.1.0 primary-checkout guard, byte-for-byte, and re-wire it into
the gx CLI + npm package:

1. Bring back `templates/githooks/post-checkout` from commit `c6d4dc3`
   (68-line bash hook, unchanged).
2. Install it as `.githooks/post-checkout` in this repo so guardex's own
   primary checkout is protected.
3. Re-add the four CLI registration sites in `bin/multiagent-safety.js`
   (`TEMPLATE_FILES`, `EXECUTABLE_RELATIVE_PATHS`, `CRITICAL_GUARDRAIL_PATHS`,
   `MANAGED_GITIGNORE_PATHS`) so `gx setup` / `gx doctor` install, chmod,
   enforce, and gitignore the hook in every downstream repo consistently with
   the other git hooks.
4. Add a single sentence to `templates/AGENTS.multiagent-safety.md` and the
   installed `AGENTS.md` describing the primary-checkout rule and the
   `GUARDEX_ALLOW_PRIMARY_BRANCH_SWITCH=1` bypass.
5. Bump `package.json` from `7.0.0` → `7.0.1` so the fix can be published.

## Impact

- **Safety.** Agent sessions (`CLAUDECODE`, `CODEX_THREAD_ID`, `OMX_SESSION_ID`,
  `CLAUDE_CODE_SESSION_ID`, `CODEX_CI=1`) that attempt `git checkout <branch>`
  on a primary working tree are auto-reverted to the previous protected
  branch when the tree is clean. A dirty tree is preserved and a manual
  recovery hint is printed.
- **Human opt-out.** Non-agent sessions see a loud warning but are NOT
  auto-reverted. `GUARDEX_ALLOW_PRIMARY_BRANCH_SWITCH=1` bypasses the guard
  entirely for intentional switches.
- **Secondary worktrees.** The hook detects the primary-vs-worktree distinction
  via `git-dir` vs `git-common-dir` and no-ops inside every secondary
  worktree, so agent sandbox creation and normal worktree operations are
  unaffected.
- **Publish.** Version 7.0.1 can be published to npm as a clean patch on top
  of 7.0.0.
- **Downstream rollout.** Next `gx setup` / `gx doctor` run in each consumer
  repo (including recodee) installs the hook automatically. No manual step
  required.
