#!/usr/bin/env bash
# Claude Stop hook: when a Claude session ends inside an agent/* worktree,
# hand the lane to the canonical Guardex finish flow so commits, PR merge wait,
# and sandbox cleanup stay coupled.
#
# Modes:
#   GUARDEX_CLAUDE_STOP_FINISH=commit  auto-commit dirty work via gx finish (default)
#   GUARDEX_CLAUDE_STOP_FINISH=clean   finish only clean committed lanes
#   GUARDEX_CLAUDE_STOP_FINISH=off     disable the hook
#
# The hook is fail-open: finish failures keep the sandbox and print a recovery
# command, but never block Claude's Stop event.

set -euo pipefail

NODE_BIN="${GUARDEX_NODE_BIN:-node}"
CLI_ENTRY="${GUARDEX_CLI_ENTRY:-}"

run_guardex_cli() {
  if [[ -n "$CLI_ENTRY" ]]; then
    "$NODE_BIN" "$CLI_ENTRY" "$@"
    return $?
  fi
  if command -v gx >/dev/null 2>&1; then
    gx "$@"
    return $?
  fi
  if command -v gitguardex >/dev/null 2>&1; then
    gitguardex "$@"
    return $?
  fi
  echo "[agent-claude-stop-finish] Guardex CLI entrypoint unavailable; rerun via gx." >&2
  return 127
}

normalize_mode() {
  local raw="${1:-commit}" lowered
  lowered="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$lowered" in
    ''|1|true|yes|on|commit|dirty|auto) printf 'commit' ;;
    clean|committed) printf 'clean' ;;
    0|false|no|off|none|disabled) printf 'off' ;;
    *)
      echo "[agent-claude-stop-finish] Unknown GUARDEX_CLAUDE_STOP_FINISH='${raw}', using commit." >&2
      printf 'commit'
      ;;
  esac
}

json_field() {
  local key="$1"
  python3 -c '
import json
import sys

key = sys.argv[1]
try:
    data = json.loads(sys.stdin.read() or "{}")
except Exception:
    data = {}
value = data.get(key, "")
if isinstance(value, bool):
    print("true" if value else "false")
elif value is not None:
    print(value)
' "$key" 2>/dev/null || true
}

resolve_base_branch() {
  local repo="$1" branch="$2" configured head_ref cand
  configured="$(git -C "$repo" config --get "branch.${branch}.guardexBase" 2>/dev/null || true)"
  if [[ -n "$configured" ]]; then
    printf '%s' "$configured"
    return 0
  fi
  configured="$(git -C "$repo" config --get multiagent.baseBranch 2>/dev/null || true)"
  if [[ -n "$configured" ]]; then
    printf '%s' "$configured"
    return 0
  fi
  head_ref="$(git -C "$repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  if [[ -n "$head_ref" ]]; then
    printf '%s' "${head_ref#origin/}"
    return 0
  fi
  for cand in main dev master; do
    if git -C "$repo" show-ref --verify --quiet "refs/heads/${cand}"; then
      printf '%s' "$cand"
      return 0
    fi
  done
  printf 'main'
}

base_ref_for_count() {
  local repo="$1" base="$2"
  if git -C "$repo" show-ref --verify --quiet "refs/heads/${base}"; then
    printf '%s' "$base"
    return 0
  fi
  if git -C "$repo" show-ref --verify --quiet "refs/remotes/origin/${base}"; then
    printf 'origin/%s' "$base"
    return 0
  fi
  return 1
}

dirty_count() {
  local wt="$1"
  git -C "$wt" status --porcelain -- . ":(exclude).omx/state/agent-file-locks.json" 2>/dev/null | grep -c . || true
}

payload="$(cat || true)"
event="$(printf '%s' "$payload" | json_field hook_event_name)"
stop_hook_active="$(printf '%s' "$payload" | json_field stop_hook_active)"
session_cwd="$(printf '%s' "$payload" | json_field cwd)"

if [[ -n "$event" && "$event" != "Stop" ]]; then
  exit 0
fi
if [[ "$stop_hook_active" == "true" ]]; then
  exit 0
fi

mode="$(normalize_mode "${GUARDEX_CLAUDE_STOP_FINISH:-commit}")"
if [[ "$mode" == "off" ]]; then
  exit 0
fi

if [[ -z "$session_cwd" || ! -d "$session_cwd" ]]; then
  session_cwd="$PWD"
fi

if ! worktree_path="$(git -C "$session_cwd" rev-parse --show-toplevel 2>/dev/null)"; then
  exit 0
fi
if ! branch="$(git -C "$worktree_path" rev-parse --abbrev-ref HEAD 2>/dev/null)"; then
  exit 0
fi
if [[ "$branch" != agent/* ]]; then
  exit 0
fi

base_branch="$(resolve_base_branch "$worktree_path" "$branch")"
base_ref=""
ahead="0"
if base_ref="$(base_ref_for_count "$worktree_path" "$base_branch")"; then
  ahead="$(git -C "$worktree_path" rev-list --count "${base_ref}..${branch}" 2>/dev/null || printf '0')"
fi
dirty="$(dirty_count "$worktree_path")"

if [[ "$dirty" -eq 0 && "$ahead" -eq 0 ]]; then
  exit 0
fi

finish_cmd=(branch finish --branch "$branch" --base "$base_branch" --via-pr --wait-for-merge --cleanup)

if [[ "$dirty" -gt 0 && "$mode" == "clean" ]]; then
  echo "[agent-claude-stop-finish] ${branch}: ${dirty} uncommitted change(s); clean-only mode left the sandbox open." >&2
  echo "[agent-claude-stop-finish] Finish manually when ready: gx ${finish_cmd[*]}" >&2
  exit 0
fi

echo "[agent-claude-stop-finish] ${branch}: handing off to gx ${finish_cmd[*]}" >&2
finish_output=""
if finish_output="$(run_guardex_cli "${finish_cmd[@]}" 2>&1)"; then
  printf '%s\n' "$finish_output"
  echo "[agent-claude-stop-finish] ${branch}: finish completed." >&2
  exit 0
fi

printf '%s\n' "$finish_output" >&2
echo "[agent-claude-stop-finish] ${branch}: finish did not complete; sandbox kept at ${worktree_path}." >&2
echo "[agent-claude-stop-finish] Retry when ready: gx ${finish_cmd[*]}" >&2
exit 0
