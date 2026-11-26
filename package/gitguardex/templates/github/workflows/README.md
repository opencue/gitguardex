# `templates/github/workflows/` — budget-friendly CI defaults

Workflow files in this directory are copied into a gitguardex-managed
project's `.github/workflows/` directory when bootstrapping. They are
the **default** budget posture for projects that use `gx branch start`
to drive agent iterations.

Agent flows land a high volume of PRs per month. Without these trims,
every PR + every post-merge push fans out across CI, CodeQL, and
Scorecard — which dominates the GitHub Actions bill for any
multi-agent repo. The trims below cut that cost without giving up
correctness coverage.

No AI-code-review workflow is scaffolded. `gx` drives review from the
CLI side (`gx review`, `gx branch finish --gate-review`), so a
per-PR review workflow was a second, unconfigured copy of the same
gate: without an `OPENAI_API_KEY` repo secret it reported a green
check that had reviewed nothing. Wire review into the finish gate
instead, where a missing provider fails closed.

## What's trimmed and why

1. **`concurrency: cancel-in-progress: true`** scoped per workflow + ref
   so rapid pushes to the same agent branch cancel the prior run
   instead of letting both finish on Actions minutes.

2. **`if: github.event.pull_request.draft == false`** on every job that
   shouldn't run on a draft PR, paired with
   `pull_request.types: [..., ready_for_review]` in the trigger list so
   CI fires the moment the PR is promoted out of draft.

3. **No `push: main` trigger** in `ci.yml` — branch protection on
   `main` forces all changes through a PR, so PR-time CI is sufficient
   and post-merge CI on `main` was pure duplication. Use
   `workflow_dispatch` for ad-hoc full runs.

4. **`paths-ignore`** for docs / openspec / template-only changes — skip
   CI on changes that don't affect runtime behavior.

## Customizing

- Replace `placeholder` steps in `ci.yml` with your build/test/lint
  commands.
- Keep the `concurrency:`, `if:`, and `paths-ignore:` patterns. They
  are the load-bearing part of the budget posture; removing them undoes
  the win.

## When to skip the draft-skip pattern

If your CI is fast (≤ 2 min) and you want continuous validation as
agents iterate, drop the `if: pull_request.draft == false` job guard.
The concurrency cancel alone still prevents minute pile-up.

## Where AI code review lives

Not in a workflow. Run it from the CLI, where a missing or broken
provider blocks the merge instead of reporting a green check:

- `gx review --only-pr <n> --once` — review an open PR on demand.
- `gx branch finish --gate-review` — fail-closed gate; refuses to
  merge unless the review comes back clean.

A `cr.yml`-style workflow was scaffolded here until it proved to be
the wrong shape: repos without an `OPENAI_API_KEY` secret got a
`review` check that passed in six seconds having read nothing, which
reads as "reviewed" on the PR page. One gate, one place.

## Per-PR label opt-in

`ci-full.yml` honors a PR label so the occasional agent PR that
actually needs the heavier check can opt in without flipping a global
toggle:

| Label | Effect |
| --- | --- |
| `needs-ci-full` | Run the full cross-runtime matrix from `ci-full.yml` on this PR instead of waiting for the weekly schedule. Useful before a release branch lands. |

To enable: open the PR, then `gh pr edit <num> --add-label needs-ci-full`
(or click the labels picker in the GitHub UI). The label-trigger fires
the workflow immediately; you don't need to re-push.

Add the label definition to your repo with `gh label create
needs-ci-full --description "Run the full CI matrix on this PR"`, or
define it in `.github/labels.yml` if you use a label-sync workflow.

## What about CodeQL / Scorecard?

The gitguardex repo itself runs CodeQL and Scorecard on the **weekly
schedule + `workflow_dispatch`** only — not on per-PR / per-push
triggers. Those workflows are long-running (5–10 min for CodeQL) and
were the largest single line item on the monthly Actions bill before
this change. If your project needs per-PR CodeQL gating for compliance
reasons, re-add the `pull_request` trigger and accept the cost; for
most repos, weekly + on-demand is the right default.
