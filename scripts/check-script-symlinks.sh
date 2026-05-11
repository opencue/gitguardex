#!/usr/bin/env bash
# Verify every paired script under scripts/ is a symlink to templates/scripts/.
# Single source of truth lives in templates/scripts/ because the gx CLI invokes
# templates/scripts/ at runtime (see src/context.js:247, PACKAGE_SCRIPT_ASSETS).
# Without this guard, contributors silently re-introduce the scripts/ ↔ templates/scripts/
# drift that PR #547 had to fix retroactively.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$repo_root"

# Paths under scripts/ that MUST be symlinks pointing into ../templates/scripts/.
# Keep this list in sync with LEGACY_WORKFLOW_SHIM_SPECS + tracked counterparts
# in src/context.js. Files that are intentionally gitignored or scaffolded
# locally (e.g. guardex-env.sh, guardex-docker-loader.sh) are excluded.
required_symlinks=(
  scripts/agent-branch-start.sh
  scripts/agent-branch-finish.sh
  scripts/agent-branch-merge.sh
  scripts/agent-file-locks.py
  scripts/agent-worktree-prune.sh
  scripts/codex-agent.sh
  scripts/install-agent-git-hooks.sh
  scripts/review-bot-watch.sh
  scripts/openspec/init-change-workspace.sh
  scripts/openspec/init-plan-workspace.sh
)

problems=()
for path in "${required_symlinks[@]}"; do
  if [[ ! -L "$path" ]]; then
    problems+=("not a symlink: $path")
    continue
  fi
  target="$(readlink "$path")"
  expected_basename="$(basename "$path")"
  if [[ "$path" == scripts/openspec/* ]]; then
    expected_prefix="../../templates/scripts/openspec/"
  else
    expected_prefix="../templates/scripts/"
  fi
  expected_target="${expected_prefix}${expected_basename}"
  if [[ "$target" != "$expected_target" ]]; then
    problems+=("wrong symlink target: $path -> $target (expected $expected_target)")
    continue
  fi
  if [[ ! -f "$path" ]]; then
    problems+=("symlink dangling (target file missing): $path -> $target")
    continue
  fi
done

if [[ ${#problems[@]} -gt 0 ]]; then
  echo "[check-script-symlinks] FAIL: ${#problems[@]} problem(s) detected." >&2
  printf '  - %s\n' "${problems[@]}" >&2
  echo "" >&2
  echo "[check-script-symlinks] The scripts/ paired files must be symlinks into ../templates/scripts/." >&2
  echo "[check-script-symlinks] Fix with (for each offender):" >&2
  echo "  rm scripts/<file> && ln -s ../templates/scripts/<file> scripts/<file>" >&2
  exit 1
fi

echo "[check-script-symlinks] OK: ${#required_symlinks[@]} paired script(s) verified."
