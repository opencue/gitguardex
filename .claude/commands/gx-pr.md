# /gx-pr

Drive a pull request from the current agent worktree.

Default (`/gx-pr` with no args): show PR status for the current branch +
CI rollup.

Subcommands:

| Subcommand | Effect |
|---|---|
| `gx pr` / `gx pr status` | Print PR number, URL, mergeability, CI summary. |
| `gx pr open` | Idempotent: push branch + create draft PR if none exists. |
| `gx pr sync` | Push, ensure PR exists, optionally `--auto-merge` / `--ready`. |
| `gx pr watch` | Poll PR until merged / failed / timeout (`--timeout 600`). |
| `gx pr ready` | Promote draft → ready for review. |
| `gx pr list` | List open PRs in the current repo. |
| `gx pr review` | Run AI PR review (Codex first, Claude if Codex cannot launch). |

Flags:

- `--base <branch>` (default: detected from `origin/HEAD`)
- `--title "..."`, `--body "..."`
- `--no-draft`, `--no-push`
- `--auto-merge`, `--merge-strategy squash|merge|rebase`
- `--json` for machine-readable output

When to use vs `gx branch finish`:

- `gx pr ...` is the *low-level* PR plumbing for an agent that wants
  explicit control (status checks, ad-hoc PR creation outside a finish flow).
- `gx branch finish --via-pr --wait-for-merge --cleanup` is still the
  default *end-of-task* command and handles PR + auto-merge + worktree
  cleanup in one shot. Use that when the work is genuinely done.
