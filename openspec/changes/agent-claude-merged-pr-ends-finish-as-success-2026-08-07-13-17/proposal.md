## Why

`gx branch finish` could merge the PR and still exit 1, so a successful ship
read as a failure. The merge lands, then cleanup runs `git branch -d` on the
source branch; `git branch -d` requires an ancestor link to HEAD or full
coverage by the branch's upstream, and a squash merge — this flow's default
(`gh pr merge --squash`) — creates neither once the remote branch is gone. The
refusal was fatal (`exit 1`), even though every other post-merge cleanup step
(remote delete, worktree prune) only warns.

Observed on PR #695: the merge completed, the local branch had been rebased
during finish, `git branch -d` reported "not fully merged", and the run ended
`branchFinish command failed with status 1` with no statement that the merge
had succeeded. The visible outcome invited a force-push to "fix" a merge that
had already landed.

## What Changes

- Print a definitive `✅ MERGED <branch> -> <base>` line (plus the PR URL) as
  soon as the merge is confirmed, before any cleanup runs, so the outcome
  cannot be buried under cleanup warnings.
- Treat a refused post-merge local-branch delete as a warning, not a failure.
  The merge already landed; cleanup leftovers are reported, never fatal.
- When `git branch -d` refuses, ask GitHub whether that exact head landed in a
  merged PR (`read_merged_pr_for_head`). If it did — the ordinary squash-merge
  case — force the delete. If it did not, keep the branch: its commits exist
  nowhere else.
- When a branch is deliberately kept, skip `--delete-branches` /
  `--delete-remote-branches` on the follow-up prune, which deletes with
  `git branch -D` and would otherwise destroy exactly what was just protected.
- Report the real outcome in the closing summary ("kept source branch" vs the
  existing "cleaned source branch/remote" and "cleaned source branch/worktree"
  wordings, both preserved verbatim).

## Impact

- Affected surface: `templates/scripts/agent-branch-finish.sh` cleanup path
  (symlinked as `scripts/agent-branch-finish.sh`); `test/finish.test.js`.
- Exit-status change: a merged PR whose local branch cannot be deleted now
  exits 0 instead of 1. Callers that treated exit 1 as "merge failed" get a
  more accurate signal; nothing that previously exited 0 changes.
- Risk: force-deleting a branch that did not really land. Mitigated by gating
  the force on GitHub's merged-PR record for that exact head SHA, and by
  keeping the branch plus its remote whenever that check does not confirm.
- No API, schema, or config surface changes. No version bump.
