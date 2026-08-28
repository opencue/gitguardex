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
  guardex_git_clean_env -C "$repo_root" config --local --get multiagent.worktreeMode 2>/dev/null || true
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

guardex_repo_has_shared_agent_activity() {
  local repo_root="$1"
  local mode remote shared status

  if [[ -v GUARDEX_SHARED_STATE ]]; then
    mode="${GUARDEX_SHARED_STATE:-}"
  elif mode="$(guardex_git_clean_env -C "$repo_root" config --local --get multiagent.sharedState 2>/dev/null)"; then
    :
  else
    status=$?
    [[ "$status" -eq 1 ]] && return 1
    return 0
  fi
  [[ "${mode,,}" == "git" ]] || return 1

  if [[ -v GUARDEX_SHARED_STATE_REMOTE ]]; then
    remote="${GUARDEX_SHARED_STATE_REMOTE:-}"
  elif remote="$(guardex_git_clean_env -C "$repo_root" config --local --get multiagent.sharedStateRemote 2>/dev/null)"; then
    :
  else
    status=$?
    [[ "$status" -eq 1 ]] || return 0
    remote="origin"
  fi
  remote="${remote:-origin}"
  [[ "$remote" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$ ]] || return 0

  local timeout_bin=""
  timeout_bin="$(command -v timeout 2>/dev/null || command -v gtimeout 2>/dev/null || true)"
  if [[ -n "$timeout_bin" ]]; then
    shared="$("$timeout_bin" 15s bash -c '
      unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX
      export GIT_TERMINAL_PROMPT=0
      git "$@"
    ' guardex-shared-state -C "$repo_root" ls-remote --refs "$remote" \
      'refs/gitguardex/locks/*' 2>/dev/null)" || return 0
  else
    return 0
  fi
  [[ -n "$shared" ]]
}

guardex_repo_has_competing_worktree_activity() {
  local repo_root="$1"
  local node_bin="${2:-node}"
  local current_path line worktree_list worktree_path worktree_real_path dirty lock_file lock_status

  if ! current_path="$(cd "$repo_root" && pwd -P)"; then
    return 0
  fi

  if guardex_repo_has_shared_agent_activity "$repo_root"; then
    return 0
  fi

  if ! worktree_list="$(guardex_git_clean_env -C "$repo_root" worktree list --porcelain 2>/dev/null)"; then
    return 0
  fi

  while IFS= read -r line; do
    [[ "$line" == worktree\ * ]] || continue
    worktree_path="${line#worktree }"
    [[ -d "$worktree_path" ]] || continue
    if ! worktree_real_path="$(cd "$worktree_path" && pwd -P)"; then
      return 0
    fi
    [[ "$worktree_real_path" != "$current_path" ]] || continue

    if ! dirty="$(
      guardex_git_clean_env -C "$worktree_path" status --porcelain --untracked-files=normal -- \
        . ':(exclude).omx/**' ':(exclude).omc/**' 2>/dev/null
    )"; then
      return 0
    fi
    if [[ -n "$dirty" ]]; then
      return 0
    fi

    lock_file="${worktree_path}/.omx/state/agent-file-locks.json"
    if [[ -f "$lock_file" ]]; then
      if "$node_bin" -e '
        const fs = require("node:fs");
        try {
          const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
          if (!data || typeof data !== "object" || Array.isArray(data)) process.exit(0);
          const locks = data.locks;
          if (locks !== undefined && (!locks || typeof locks !== "object" || Array.isArray(locks))) {
            process.exit(0);
          }
          process.exit(Object.keys(locks || {}).length > 0 ? 0 : 1);
        } catch {
          process.exit(0);
        }
      ' "$lock_file" >/dev/null 2>&1; then
        return 0
      else
        lock_status=$?
        if [[ "$lock_status" -ne 1 ]]; then
          return 0
        fi
      fi
    fi
  done <<< "$worktree_list"

  return 1
}

guardex_agent_session_id() {
  printf '%s' "${CODEX_THREAD_ID:-${OMX_SESSION_ID:-${CLAUDE_CODE_SESSION_ID:-}}}"
}

guardex_claim_adaptive_session_lease() {
  local repo_root="$1"
  local session_id="${2:-$(guardex_agent_session_id)}"
  local python_bin="${GUARDEX_PYTHON_BIN:-python3}"
  local common_dir

  [[ -n "$session_id" ]] || return 1
  command -v "$python_bin" >/dev/null 2>&1 || return 1
  common_dir="$(guardex_git_clean_env -C "$repo_root" rev-parse --git-common-dir 2>/dev/null)" || return 1
  if [[ "$common_dir" != /* ]]; then
    common_dir="${repo_root}/${common_dir}"
  fi
  common_dir="$(cd "$common_dir" 2>/dev/null && pwd -P)" || return 1

  "$python_bin" - "$common_dir" "$session_id" "${GUARDEX_ADAPTIVE_SESSION_LEASE_SEC:-900}" <<'PY'
import fcntl
import json
import os
import sys
import time
from pathlib import Path

common_dir, session_id, raw_ttl = sys.argv[1:]
try:
    ttl_seconds = float(raw_ttl)
except ValueError:
    raise SystemExit(1)
if not (0 < ttl_seconds < float("inf")):
    raise SystemExit(1)

state_dir = Path(common_dir) / "gitguardex"
lease_path = state_dir / "adaptive-direct-session.json"
lock_path = state_dir / "adaptive-direct-session.lock"
try:
    state_dir.mkdir(parents=True, exist_ok=True)
    lock_handle = open(lock_path, "a+")
except OSError:
    raise SystemExit(1)

try:
    fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
    try:
        lease = json.loads(lease_path.read_text())
    except FileNotFoundError:
        lease = {}
    except (OSError, json.JSONDecodeError, ValueError):
        raise SystemExit(1)
    if not isinstance(lease, dict):
        raise SystemExit(1)

    owner = lease.get("session_id")
    last_seen = lease.get("last_seen_epoch")
    if owner is not None and not isinstance(owner, str):
        raise SystemExit(1)
    if last_seen is not None and (
        isinstance(last_seen, bool) or not isinstance(last_seen, (int, float))
    ):
        raise SystemExit(1)

    now = time.time()
    if owner and owner != session_id and last_seen is not None and now - float(last_seen) < ttl_seconds:
        print("Adaptive direct work is owned by another active agent session.", file=sys.stderr)
        raise SystemExit(1)

    tmp_path = lease_path.with_name(f"{lease_path.name}.tmp-{os.getpid()}")
    try:
        tmp_path.write_text(
            json.dumps({"session_id": session_id, "last_seen_epoch": now}, sort_keys=True) + "\n"
        )
        os.replace(tmp_path, lease_path)
    except OSError:
        try:
            tmp_path.unlink()
        except OSError:
            pass
        raise SystemExit(1)
finally:
    try:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
    finally:
        lock_handle.close()
PY
}
