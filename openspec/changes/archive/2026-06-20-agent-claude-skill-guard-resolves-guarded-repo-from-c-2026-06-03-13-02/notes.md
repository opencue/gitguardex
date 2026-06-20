# agent-claude-skill-guard-resolves-guarded-repo-from-c-2026-06-03-13-02 (minimal / T1)

Branch: `agent/claude/skill-guard-resolves-guarded-repo-from-c-2026-06-03-13-02`

`skill_guard.py` now resolves the GUARDED repo from `cwd` (the repo you're working
in), not from where the target file lives — so editing a file inside a DIFFERENT
git repo than cwd (e.g. a version-controlled `~/.claude/.../memory` dir that is
its own repo on its own `main` branch) is no longer blocked by the current repo's
branch protection.

## Why

Follow-up to PR #614. #614 added `path_within_repo` + `in_repo_targets`, which
handled "target in NO repo." But the memory dir is its OWN git repo on `main`, so
`resolve_repo_root` (file_path-first) returned the memory repo, `path_within_repo`
saw the target inside it, and the protected-branch guard fired on the memory
repo's `main`. The guard should only protect the repo the session is in (cwd).

## How

- `resolve_repo_root(file_path, cwd)` resolves from `cwd` first (the guarded repo),
  falling back to `file_path` then `Path.cwd()`. One-line semantic flip.
- Downstream is unchanged: `in_repo_targets = path_within_repo(p, cwd_repo, cwd)`
  now correctly scopes the guard to the cwd repo's tree. In-repo edits on a
  protected branch are still blocked; agent-branch edits still allowed; Bash
  guarding is byte-identical (file_path empty -> already cwd-based).

## Verify

- Real case (verified): cwd=gitguardex on `main`, target=memory file in its own
  repo on `main` -> exit 0 (allowed). In-repo edit on `main` -> exit 2 (blocked).
- `node --test test/skill-guard-hook.test.js` — new tests: cross-repo write
  ALLOWED; mixed in-repo+out-of-repo patch still BLOCKED (no laundering). Full
  suite: zero regressions (same-environment baseline diff empty).
- Independent security review: ship it (no CRITICAL/HIGH; guard correctly narrowed
  to the cwd repo's own tree).
- 5 pre-existing failures in this file (claude/codex/cursor `rm` tests) are an
  env artifact (global `[agent-branch-guard]` rejects the seed commit), unrelated.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/skill-guard-resolves-guarded-repo-from-c-2026-06-03-13-02 --base main --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
