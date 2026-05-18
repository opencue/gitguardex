#!/usr/bin/env bash
# Wire guardex's hooks into the user's GLOBAL git config so they fire in
# EVERY existing and future repo on this machine. Idempotent; safe to re-run.
#
# What this does:
#   1. Ensures ~/.config/git/hooks/ exists.
#   2. Symlinks the four guardex hooks (pre-commit, pre-push, post-checkout,
#      post-merge) from this repo's .githooks/ into the global hooks dir.
#   3. Points `git config --global core.hooksPath` at it.
#
# Safety:
#   - If core.hooksPath is already set globally to a DIFFERENT path, this
#     script prints the existing value and exits 0 without overwriting.
#   - Repo-local `core.hooksPath` settings override the global one, so a
#     single repo can opt out with `git config core.hooksPath .git/hooks`.
#   - Reverse with `git config --global --unset core.hooksPath`.
#
# Intended invocation:
#   bash ~/Documents/gitguardex/scripts/install-global-hooks.sh
#   npm run guardex:install-global

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_SRC="$REPO_ROOT/.githooks"
HOOKS_DST="${XDG_CONFIG_HOME:-$HOME/.config}/git/hooks"

if [[ ! -d "$HOOKS_SRC" ]]; then
  echo "[guardex] missing $HOOKS_SRC — run from the gitguardex repo." >&2
  exit 1
fi

mkdir -p "$HOOKS_DST"

linked=0
for h in pre-commit pre-push post-checkout post-merge; do
  if [[ -f "$HOOKS_SRC/$h" ]]; then
    ln -sfn "$HOOKS_SRC/$h" "$HOOKS_DST/$h"
    linked=$((linked + 1))
  fi
done
echo "[guardex] symlinked $linked hooks → $HOOKS_DST"

current="$(git config --global --get core.hooksPath 2>/dev/null || true)"
if [[ -n "$current" && "$current" != "$HOOKS_DST" ]]; then
  echo "[guardex] core.hooksPath already set to: $current"
  echo "[guardex] not overwriting. To switch:  git config --global core.hooksPath '$HOOKS_DST'"
  exit 0
fi

git config --global core.hooksPath "$HOOKS_DST"
echo "[guardex] global core.hooksPath → $HOOKS_DST"
echo "[guardex] disable globally:      git config --global --unset core.hooksPath"
echo "[guardex] opt-out one repo:      git config core.hooksPath .git/hooks"
