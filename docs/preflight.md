# Pre-flight gate for `gx branch finish`

An ordinary `gx branch finish` runs a **pre-flight verification script**
in the agent's worktree **before** any push happens. If the script fails,
the push is refused and the PR is never created — the broken commit never
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

For a simple change that has already passed targeted local verification,
`gx branch finish --fast` is the explicit speed-over-local-gates profile. It
forces the PR path (which uses squash merge) and disables both pre-flight and
the AI review/autofix gate. GitHub branch protection and required CI checks are
not bypassed. Conflicting flags such as `--gate-review`, `--preflight`, or
`--direct-only` are rejected instead of producing a mixed policy.

For agent runs where transcript size matters more than live progress, add
`--agent-quiet`. GitGuardex captures the long finish subprocess output, keeps
the private structured event stream, and emits one compact JSON summary per
branch plus the final aggregate. Failures retain a bounded error tail. The
default remains streamed human-readable progress.

Review-gated finishes keep this repository-defined pre-flight enabled even
after required CI passes because the script can contain checks that required CI
does not. By default the PR remains draft until the AI review passes. The
explicit `--no-gate-serial-ci` fast mode overlaps CI with the review, but it does
not disable pre-flight. Only an explicit pre-flight opt-out bypasses this gate.

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
  don't support drafts — the hold still applies),
- disarms anything already primed to land the PR: previously-enabled
  GitHub auto-merge is disabled and a ready PR is demoted back to draft,
- **persists the hold** as a `guardex:merge-hold` marker in the PR body,
- **skips the merge entirely** — no immediate `gh pr merge`, no
  auto-merge enable, no merge-wait polling,
- forces the PR path: it refuses `--direct-only` and upgrades
  `--mode auto` to `--mode pr`, so nothing lands by direct push either,
- exits 0 with the worktree retained, and prints a machine-readable
  `MERGE_HELD=1` trailer so automation can tell "held" from "merged".

The persisted marker is what makes the hold real: **every** finish
re-run through the PR flow — the Claude stop hook, the doctor
auto-finish sweep, `gx finish --all`, another agent following the
finish contract — sees the marker and refuses to promote or merge.
Without persistence, any unflagged re-run would promote the draft and
land it, recreating the incident the hold exists to prevent.

Use it when a gate outside CI (an e2e run, a manual review) must pass
before the merge. When the gate passes, lift the hold with an
**explicit** `--auto-promote`:

```bash
gx branch finish --branch <agent-branch> --auto-promote
# removes the marker, promotes the draft, merges, cleans up
```

Only the explicit flag lifts it — `GUARDEX_FINISH_AUTO_PROMOTE=1` or
the default does not. (Deleting the marker from the PR body by hand
also lifts it.)

Caveats:

- `--gate-review` marks the PR ready before the shell script runs; the
  hold re-demotes it to draft, but the two flags are an odd pairing —
  prefer running the gate when you lift the hold instead.
- The finish flow consults the marker on its direct-push path too
  (`--mode auto` diverts to the PR flow, `--direct-only` refuses), but a
  raw `git push` outside `gx branch finish` to an unprotected base still
  bypasses PRs entirely — base branch protection remains the backstop.
- `GUARDEX_FINISH_AUTO_PROMOTE=0` as an ambient env var now means
  "every finish in this environment holds its merge" — set it per-call
  unless a fleet-wide merge moratorium is what you want.
- Custom `GUARDEX_GH_BIN` wrappers must answer `gh pr view --json body`
  (real `gh` always does): the marker check fails **closed**, so a
  wrapper that errors on it turns every PR-flow finish into a held,
  unmerged exit.

Without the hold, the default finish flow merges the PR the moment the
base branch has no blocking checks — there is no window to stop it.

## Flags + env vars

| CLI flag | Env var | Default | Effect |
| --- | --- | --- | --- |
| `--fast` | — | `false` | Force PR/squash mode and skip local pre-flight plus AI review/autofix; GitHub merge policy still applies. |
| `--preflight` / `--no-preflight` | `GUARDEX_FINISH_PREFLIGHT` | `true` | Run/skip the pre-flight gate. |
| `--preflight-script <path>` | `GUARDEX_FINISH_PREFLIGHT_SCRIPT` | `scripts/agent-preflight.sh` | Override the script path (relative to worktree, or absolute). |
| `--auto-promote` / `--no-auto-promote` | `GUARDEX_FINISH_AUTO_PROMOTE` | `true` | On: promote a draft PR to ready-for-review after pre-flight passes. Off: merge hold — open the PR as draft and leave it unmerged (see above). |

## When to bypass

Only use `--no-preflight` or `--fast` if:

- the pre-flight script itself is broken and you need to ship the fix,
- you are landing an emergency rollback and CI/branch protection will
  catch any remaining issue,
- the change is small and already passed the targeted checks that cover it, or
- your repo has no `scripts/agent-preflight.sh` and you've decided not
  to write one.

For ordinary "the tests are slow" cases, write a faster pre-flight
that only runs the targeted suite for changed paths, instead of
disabling the gate entirely.
