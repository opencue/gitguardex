# agent-claude-skill-guard-never-blocks-edits-to-files-2026-06-03-12-40 (minimal / T1)

Branch: `agent/claude/skill-guard-never-blocks-edits-to-files-2026-06-03-12-40`

`skill_guard.py` (PreToolUse hook) no longer blocks Edit/Write to files OUTSIDE
the guarded repo (e.g. `~/.claude/.../memory/*.md`) when the repo checkout is on
a protected branch.

## Why

`find_repo_root` falls back to `Path.cwd()` when it can't find a `.git` walking
up from the target. For a memory file under `~/.claude` (home is not a git repo),
that fallback wrongly attributed the file to the current repo (on `main`), so the
protected-branch guard blocked it: "Agent edit attempted on protected branch
'main'." Whether a memory write succeeded depended on what branch the unrelated
cwd repo was on — clearly wrong.

## How

- New `path_within_repo(target, repo_root, cwd)`: True only when the target
  resolves to a path inside the repo working tree (both sides `.resolve()`d, so
  `..`/symlinks are canonicalized first). Relative targets resolve against cwd.
- `main()` computes `in_repo_targets`; if a tool touches NO in-repo file it exits
  0 (allow). The protected-branch check, `main_rs_lock` loop, and skill-rules
  loops now operate on `in_repo_targets` only. In-repo edits on protected
  branches are still blocked; agent-branch edits still allowed.
- Canonical file `.claude/hooks/skill_guard.py` (`.codex/hooks/` is a symlink to
  it). Distributed to other repos via `gx claude install`.

## Verify

- `node --test test/skill-guard-hook.test.js` — new tests: out-of-repo write on
  `main` ALLOWED; in-repo write on `main` BLOCKED; in-repo write on `agent/*`
  ALLOWED. Full suite: zero regressions (same-environment baseline diff empty).
- 5 pre-existing failures in this file (claude/codex/cursor branch `rm` tests)
  are unrelated: the global `[agent-branch-guard]` pre-commit rejects the seed
  commit in `makeRepoOn` for non-agent branches, failing before the hook runs.
  Identical on baseline.

## Follow-ups (out of scope)

- `find_repo_root` resolves relative targets against process cwd, a latent
  relative-path edge in the rare process-cwd != session-cwd case (pre-existing).

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/skill-guard-never-blocks-edits-to-files-2026-06-03-12-40 --base main --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
