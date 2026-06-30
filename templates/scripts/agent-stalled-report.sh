#!/usr/bin/env bash
# Quiet wrapper around scripts/agent-autofinish-watch.sh that surfaces stalled
# agent/* worktrees. Prints nothing when everything's clean; prints a one-line
# summary per stalled worktree + a finish hint when there's work to recover.
#
# Designed to be wired as a SessionStart hook so Claude Code (and the user)
# learn about half-finished codex/claude agent runs at the top of each session.
#
# Exit codes:
#   0 — no stalled worktrees (or watcher missing — soft fail)
#   0 — even when stalled worktrees ARE detected (this is informational, not a hard error)

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
watcher="${repo_root}/scripts/agent-autofinish-watch.sh"

if [[ ! -x "$watcher" ]]; then
  exit 0
fi

raw_output="$(bash "$watcher" --once --dry-run 2>&1 || true)"

# Filter to per-worktree status lines only ("[agent-autofinish-watch] agent/<branch>: ...").
stalled_lines="$(printf '%s\n' "$raw_output" | grep -E '^\[agent-autofinish-watch\] agent/' || true)"

if [[ -z "$stalled_lines" ]]; then
  exit 0
fi

stalled_count="$(printf '%s\n' "$stalled_lines" | wc -l | tr -d ' ')"

printf '⚠ Stalled agent worktrees detected (%s):\n' "$stalled_count"
printf '%s\n' "$stalled_lines" | sed 's/^\[agent-autofinish-watch\] /  • /'
printf '\nResolve options:\n'
printf '  • Inspect:     bash scripts/agent-autofinish-watch.sh --once --dry-run\n'
printf '  • Auto-finish: bash scripts/agent-autofinish-watch.sh --once --auto-merge\n'
printf '  • Run daemon:  bash scripts/agent-autofinish-watch.sh --daemon --auto-merge\n'

exit 0
