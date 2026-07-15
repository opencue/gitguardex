# Pre-flight gate for `gx branch finish`

`gx branch finish` runs a **pre-flight verification script** in the
agent's worktree **before** any push happens. If the script fails, the
push is refused and the PR is never created — the broken commit never
reaches CI, the merge funnel, or the review surface.

This is the cheapest gate in the agent workflow:

| Gate | Cost | Catches |
| --- | --- | --- |
| Local pre-flight (this) | free, runs on agent's CPU | most regressions before they reach CI |
| Draft PR (gx finish opens it) | $0 — draft skips CI | nothing extra; the gate is the next step |
| `ready_for_review` flip (auto-promote) | first CI run | regressions pre-flight missed |
| Branch protection on `main` | required CI must be green | merge-time defense in depth |

Pre-flight is enabled by default. Disable per-call with `--no-preflight`,
or globally with `GUARDEX_FINISH_PREFLIGHT=0`.

## Convention

`gx branch finish` looks for `scripts/agent-preflight.sh` inside the
target repo's working tree. If it is executable, it runs from the repo
root. Non-zero exit refuses the push.

For gitguardex-managed projects, `gx setup` scaffolds a default
`scripts/agent-preflight.sh` that auto-detects the project stack and
runs conventional verification:

- **Node + pnpm** (lockfile present): `pnpm typecheck && pnpm lint && pnpm test`, each only if the package.json script exists.
- **Node + npm** (lockfile present): `npm test` if defined.
- **Rust** (`Cargo.toml`): `cargo check --quiet`.
- **Python** (`pyproject.toml`): `ruff check .` if `ruff` is installed.

If none of these match, pre-flight passes with a warn-only message —
the script doesn't refuse pushes for repos it can't classify.

## Override per-project

Replace the symlinked default with a custom script:

```bash
rm scripts/agent-preflight.sh                # remove the symlink
# write your own script that exits non-zero on failure
chmod +x scripts/agent-preflight.sh
```

The custom script receives no arguments and runs with the worktree as
its working directory. It MUST return non-zero to block a push.

## Auto-promote on pass

After pre-flight passes, `gx branch finish` creates the PR. If the PR
is in draft state (manually opened earlier, or opened by the merge
hold below), the finish script automatically marks it
ready-for-review by calling `gh pr ready`. With the budget-friendly
CI defaults (draft PRs skip CI), this is the moment CI is allowed to
fire — once, on a known-passing commit.

Disable per-call with `--no-auto-promote`, or globally with
`GUARDEX_FINISH_AUTO_PROMOTE=0`.

## Merge hold (`--no-auto-promote`)

`--no-auto-promote` is a **merge hold**, not just a promote skip. With
it, `gx branch finish`:

- opens the PR as a **draft** (falls back to a ready PR on plans that
  don't support drafts — the hold below still applies),
- **skips the merge entirely** — no immediate `gh pr merge`, no
  auto-merge enable, no merge-wait polling,
- forces the PR path: it refuses `--direct-only` and upgrades
  `--mode auto` to `--mode pr`, so nothing lands by direct push either,
- exits 0 with the worktree retained.

Use it when a gate outside CI (an e2e run, a manual review) must pass
before the merge. When the gate passes, lift the hold:

```bash
gh pr ready <pr-url>                       # if the PR is still draft
gx branch finish --branch <agent-branch>   # merges + cleans up
```

Without the hold, the default finish flow merges the PR the moment the
base branch has no blocking checks — there is no window to stop it.

## Flags + env vars

| CLI flag | Env var | Default | Effect |
| --- | --- | --- | --- |
| `--preflight` / `--no-preflight` | `GUARDEX_FINISH_PREFLIGHT` | `true` | Run/skip the pre-flight gate. |
| `--preflight-script <path>` | `GUARDEX_FINISH_PREFLIGHT_SCRIPT` | `scripts/agent-preflight.sh` | Override the script path (relative to worktree, or absolute). |
| `--auto-promote` / `--no-auto-promote` | `GUARDEX_FINISH_AUTO_PROMOTE` | `true` | On: promote a draft PR to ready-for-review after pre-flight passes. Off: merge hold — open the PR as draft and leave it unmerged (see above). |

## When to bypass

Only `--no-preflight` if:

- the pre-flight script itself is broken and you need to ship the fix,
- you are landing an emergency rollback and CI/branch protection will
  catch any remaining issue, or
- your repo has no `scripts/agent-preflight.sh` and you've decided not
  to write one.

For ordinary "the tests are slow" cases, write a faster pre-flight
that only runs the targeted suite for changed paths, instead of
disabling the gate entirely.
