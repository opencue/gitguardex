#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  echo "[install-agent-git-hooks] Not inside a git repository." >&2
  exit 1
fi

hooks_dir="$repo_root/.githooks"
if [[ ! -d "$hooks_dir" ]]; then
  echo "[install-agent-git-hooks] Missing hooks directory: $hooks_dir" >&2
  exit 1
fi

chmod +x "$hooks_dir"/* 2>/dev/null || true

git -C "$repo_root" config core.hooksPath .githooks

echo "[install-agent-git-hooks] Installed repo hooks path: .githooks"
echo "[install-agent-git-hooks] Branch protection hook is now active for this repo clone."
