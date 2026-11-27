# See GitGuardex in action

Git worktrees isolate checkouts. GitGuardex adds shared file ownership before
agents edit, then makes the evidence behind a merge visible on the PR.

## Try a file collision in under a minute

From a GitGuardex checkout, run:

```sh
node examples/agent-collision-demo.js
```

All you need is Node.js 18+, Git, and Python 3. No installation, GitHub
token, or AI account. The demo creates a temporary repo and two real worktrees.
Simulated Codex and Claude lanes make real `gx locks claim` requests: the first
can edit its claimed file, the second is denied the overlapping claim, and a
disjoint edit succeeds. The temporary repo is removed on exit. Claims coordinate
agents using the GitGuardex workflow; they are not OS-level file permissions.

## See why a PR is or isn't mergeable

In a GitHub repository, with an authenticated GitHub CLI:

```sh
gx pr evidence 123         # preview without writing to GitHub
gx pr evidence 123 --post  # create or update your evidence comment on PR #123
```

The card shows the exact head and base commits, a link to current-head review
evidence, CI and GitHub merge status, a next step, and recorded dismissal
reasons from GitHub reviews or revision-scoped GitGuardex improvements.
An ordinary posted review is not proof of a clean gate for both commits;
only a verified local gate receipt
provides that evidence. The card is a snapshot, not an approval, and never
overrides GitHub requirements. Refresh it after a push, review, or CI rerun.
Use the same GitHub account to update the existing card.

## Reproduce the comparison

Run the [paired benchmark](./parallel-agent-benchmark/README.md) to compare
ordinary worktrees against GitGuardex on the same fixtures. Keep the raw results
and report local and hosted runs separately.
