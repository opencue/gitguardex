---
name: gx-act
description: "Run GitHub Actions workflows locally with nektos/act before pushing, so CI failures are caught on the laptop and the PR can be squash-merged on the first remote run."
---

# gx-act — local GitHub Actions

Use whenever a change touches code that would trigger CI on GitHub. Run the workflows locally with `act` first; only push the branch when the local run is green, then squash-merge the PR on GitHub.

## When to invoke

- Before `gx pr open` / `gx pr sync` / `gx branch finish --via-pr`.
- Before re-pushing after a CI failure.
- When iterating on `.github/workflows/*.yml` itself.

## Install `act`

`act` requires Docker (or Podman). Check the binary:

```sh
command -v act || echo "act not installed"
```

Install one way:

```sh
# Linux/macOS via the upstream installer
curl -fsSL https://raw.githubusercontent.com/nektos/act/master/install.sh | bash -s -- -b "$HOME/.local/bin"

# macOS via Homebrew
brew install act

# Arch
sudo pacman -S act

# Or use the GitHub CLI extension
gh extension install https://github.com/nektos/gh-act
```

Upstream: https://github.com/nektos/act

## Quick commands

```sh
# List jobs the local runner would execute for the push event
act -l

# Run the default push workflows (what GitHub runs on a normal push)
act push

# Run a specific event
act pull_request
act workflow_dispatch -W .github/workflows/release.yml

# Run a single job
act -j test

# Pin a runner image (medium is the act default; large matches real GH closer)
act -P ubuntu-latest=catthehacker/ubuntu:act-latest

# Pass secrets / env without committing them
act -s GITHUB_TOKEN="$GITHUB_TOKEN" --env-file .env.act

# Reuse containers between runs (faster iteration)
act --reuse
```

## Workflow (local CI → squash-merge on GitHub)

1. Implement the change in the agent worktree.
2. `act -l` to confirm which jobs will fire for the event you care about.
3. `act push` (or the specific event/job) until it is green locally.
4. `gx branch finish --branch "<agent-branch>" --base main --via-pr --wait-for-merge --cleanup`.
   - Or `gx pr open` then `gx pr sync --auto-merge --merge-strategy squash` for explicit PR control.
5. On GitHub: squash-merge once the remote run mirrors the local one.

## Notes

- `act` does not reproduce GitHub-hosted services exactly (no real secrets, different runner image, no concurrency groups). Treat a green `act` run as a strong signal, not a proof — the remote run is still authoritative.
- Keep `act` config in `.actrc` at the repo root so every agent uses the same runner image.
- If a workflow uses `GITHUB_TOKEN` for API calls, pass a PAT via `-s GITHUB_TOKEN=...`; do not commit it.
- Add `.actrc`, `.cache/act`, and any `act`-specific event payloads to `.gitignore` if they appear.
