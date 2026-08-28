#!/usr/bin/env bash

guardex_normalize_bool() {
  local raw="${1:-}"
  local fallback="${2:-}"
  local lowered
  lowered="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$lowered" in
    1|true|yes|on) printf '1' ;;
    0|false|no|off) printf '0' ;;
    '') printf '%s' "$fallback" ;;
    *) printf '%s' "$fallback" ;;
  esac
}

guardex_git_clean_env() (
  unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX
  git "$@"
)

guardex_read_repo_dotenv_var() {
  local repo_root="$1"
  local key="${2:-GUARDEX_ON}"
  local env_file="${repo_root}/.env"
  local line value

  [[ -f "$env_file" ]] || return 1

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=(.*)$ ]]; then
      value="${BASH_REMATCH[2]}"
      value="$(printf '%s' "$value" | sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//')"
      if [[ "$value" == \"*\" && "$value" == *\" ]]; then
        value="${value:1:${#value}-2}"
      elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
        value="${value:1:${#value}-2}"
      fi
      printf '%s' "$value"
      return 0
    fi
  done < "$env_file"

  return 1
}

guardex_repo_toggle_raw() {
  local repo_root="$1"
  if [[ -n "${GUARDEX_ON:-}" ]]; then
    printf '%s' "$GUARDEX_ON"
    return 0
  fi
  guardex_read_repo_dotenv_var "$repo_root" "GUARDEX_ON"
}

guardex_repo_toggle_source() {
  local repo_root="$1"
  if [[ -n "${GUARDEX_ON:-}" ]]; then
    printf 'process environment'
    return 0
  fi
  if guardex_read_repo_dotenv_var "$repo_root" "GUARDEX_ON" >/dev/null; then
    printf 'repo .env'
    return 0
  fi
  return 1
}

guardex_repo_is_enabled() {
  local repo_root="$1"
  local raw normalized
  if raw="$(guardex_repo_toggle_raw "$repo_root")"; then
    normalized="$(guardex_normalize_bool "$raw" "")"
    if [[ "$normalized" == "0" ]]; then
      return 1
    fi
  fi
  return 0
}

guardex_repo_worktree_mode_raw() {
  local repo_root="$1"
  local configured
  if [[ -n "${GUARDEX_WORKTREE_MODE:-}" ]]; then
    printf '%s' "$GUARDEX_WORKTREE_MODE"
    return 0
  fi
  if configured="$(guardex_read_repo_dotenv_var "$repo_root" "GUARDEX_WORKTREE_MODE")"; then
    printf '%s' "$configured"
    return 0
  fi
  guardex_git_clean_env -C "$repo_root" config --get multiagent.worktreeMode 2>/dev/null || true
}

guardex_repo_worktree_mode() {
  local repo_root="$1"
  local raw lowered
  raw="$(guardex_repo_worktree_mode_raw "$repo_root")"
  lowered="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$lowered" in
    adaptive) printf 'adaptive' ;;
    *) printf 'always' ;;
  esac
}

guardex_repo_has_competing_worktree_activity() {
  local repo_root="$1"
  local node_bin="${2:-node}"
  local line worktree_path worktree_index=0 dirty lock_file

  while IFS= read -r line; do
    [[ "$line" == worktree\ * ]] || continue
    worktree_index=$((worktree_index + 1))
    [[ "$worktree_index" -gt 1 ]] || continue
    worktree_path="${line#worktree }"
    [[ -d "$worktree_path" ]] || continue

    dirty="$(
      guardex_git_clean_env -C "$worktree_path" status --porcelain --untracked-files=normal -- \
        . ':(exclude).omx/**' ':(exclude).omc/**' 2>/dev/null || true
    )"
    if [[ -n "$dirty" ]]; then
      return 0
    fi

    lock_file="${worktree_path}/.omx/state/agent-file-locks.json"
    if [[ -f "$lock_file" ]] && "$node_bin" -e '
      const fs = require("node:fs");
      try {
        const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        process.exit(Object.keys(data?.locks || {}).length > 0 ? 0 : 1);
      } catch {
        process.exit(1);
      }
    ' "$lock_file" >/dev/null 2>&1; then
      return 0
    fi
  done < <(guardex_git_clean_env -C "$repo_root" worktree list --porcelain 2>/dev/null || true)

  return 1
}
