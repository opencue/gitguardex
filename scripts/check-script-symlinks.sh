#!/usr/bin/env bash
# Verify the repo's two mirrored trees are symlinks, not copies:
#
#   scripts/        -> templates/scripts/   (single source of truth: the gx CLI
#                                            invokes templates/scripts/ at runtime,
#                                            see src/context.js:247,
#                                            PACKAGE_SCRIPT_ASSETS)
#   .codex/hooks/   -> .claude/hooks/       (both harnesses must execute the same
#                                            hook code, see .claude/hooks/HOOKS.md)
#
# Without this guard, contributors silently re-introduce the scripts/ ↔ templates/scripts/
# drift that PR #547 had to fix retroactively, or the .codex/hooks/ ↔ .claude/hooks/
# drift that PR #703 landed (two hooks committed as real copies).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$repo_root"

# Paths under scripts/ that MUST be symlinks pointing into ../templates/scripts/.
# Keep this list in sync with LEGACY_WORKFLOW_SHIM_SPECS + tracked counterparts
# in src/context.js. Files that are intentionally gitignored or scaffolded
# locally (e.g. guardex-env.sh, guardex-docker-loader.sh) are excluded.
required_symlinks=(
  scripts/agent-autofinish-watch.sh
  scripts/agent-branch-start.sh
  scripts/agent-branch-finish.sh
  scripts/agent-branch-merge.sh
  scripts/agent-claude-stop-finish.sh
  scripts/agent-file-locks.py
  scripts/agent-preflight.sh
  scripts/agent-stalled-report.sh
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

script_problem_count=${#problems[@]}

# Every tracked hook under .codex/hooks/ MUST be a relative symlink to its
# .claude/hooks/ counterpart. Derived from the tracked file list rather than a
# hand-maintained array on purpose: a hook added tomorrow is covered the moment
# it lands. A fixed list would not have caught PR #703, because nobody adding a
# new hook would have thought to extend the list.
hook_symlinks=()
while IFS= read -r path; do
  [[ -n "$path" ]] && hook_symlinks+=("$path")
done < <(git ls-files -- '.codex/hooks/*.py')

if [[ ${#hook_symlinks[@]} -eq 0 ]]; then
  problems+=("no tracked hooks found under .codex/hooks/ (expected the .claude/hooks/ mirror)")
fi

for path in "${hook_symlinks[@]}"; do
  if [[ ! -L "$path" ]]; then
    problems+=("not a symlink: $path")
    continue
  fi
  expected_target="../../.claude/hooks/$(basename "$path")"
  target="$(readlink "$path")"
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
  # Only show the fix hint for the tree that actually broke, so a hooks-only
  # failure does not lead with a scripts/ command that fixes nothing.
  if [[ $script_problem_count -gt 0 ]]; then
    echo "" >&2
    echo "[check-script-symlinks] The scripts/ paired files must be symlinks into ../templates/scripts/." >&2
    echo "[check-script-symlinks] Fix with (for each offender):" >&2
    echo "  rm scripts/<file> && ln -s ../templates/scripts/<file> scripts/<file>" >&2
  fi
  if [[ ${#problems[@]} -gt $script_problem_count ]]; then
    echo "" >&2
    echo "[check-script-symlinks] The .codex/hooks/ files must be symlinks into ../../.claude/hooks/." >&2
    echo "[check-script-symlinks] Edit only .claude/hooks/; fix a copy with:" >&2
    echo "  rm .codex/hooks/<file> && ln -s ../../.claude/hooks/<file> .codex/hooks/<file>" >&2
  fi
  exit 1
fi

echo "[check-script-symlinks] OK: ${#required_symlinks[@]} paired script(s), ${#hook_symlinks[@]} hook symlink(s) verified."
