## Why

- After a Guardex PR merge, local base checkouts can remain behind `origin/<base>` and VS Code shows pending sync/pull state even though the branch was already pushed and merged.
- Guardex already refreshes clean local base worktrees, but a harmless dirty edit currently prevents the automatic `git pull --ff-only` and leaves the operator stuck doing manual cleanup.

## What Changes

- Let `agent-branch-finish.sh` attempt the post-merge base refresh even when the local base worktree has dirty edits.
- Keep the refresh guarded: use `git pull --ff-only` with Git autostash disabled, and treat failures as warnings so Git never stashes, rebases, or overwrites local work.
- Update focused finish-flow regression coverage for dirty/non-conflicting and dirty/conflicting base worktrees.

## Impact

- Affects `gx branch finish` and `gx finish` only after a successful merge path reaches the base-worktree refresh step.
- Dirty base worktrees may now fast-forward automatically when Git can preserve local edits. If Git detects an overwrite/conflict risk, Guardex leaves the worktree untouched and reports the failed refresh.
