#!/usr/bin/env bash
set -euo pipefail

TASK_NAME="${GUARDEX_TASK_NAME:-task}"
AGENT_NAME="${GUARDEX_AGENT_NAME:-agent}"
BASE_BRANCH="${GUARDEX_BASE_BRANCH:-}"
BASE_BRANCH_EXPLICIT=0
CODEX_BIN="${GUARDEX_CODEX_BIN:-codex}"
CODEX_APPROVAL_POLICY="${GUARDEX_CODEX_APPROVAL_POLICY-never}"
NODE_BIN="${GUARDEX_NODE_BIN:-node}"
CLI_ENTRY="${GUARDEX_CLI_ENTRY:-}"
AUTO_FINISH_RAW="${GUARDEX_CODEX_AUTO_FINISH:-true}"
AUTO_REVIEW_ON_CONFLICT_RAW="${GUARDEX_CODEX_AUTO_REVIEW_ON_CONFLICT:-true}"
AUTO_CLEANUP_RAW="${GUARDEX_CODEX_AUTO_CLEANUP:-true}"
AUTO_WAIT_FOR_MERGE_RAW="${GUARDEX_CODEX_WAIT_FOR_MERGE:-true}"
OPENSPEC_AUTO_INIT_RAW="${GUARDEX_OPENSPEC_AUTO_INIT:-true}"
OPENSPEC_PLAN_SLUG_OVERRIDE="${GUARDEX_OPENSPEC_PLAN_SLUG:-}"
OPENSPEC_CHANGE_SLUG_OVERRIDE="${GUARDEX_OPENSPEC_CHANGE_SLUG:-}"
OPENSPEC_CAPABILITY_SLUG_OVERRIDE="${GUARDEX_OPENSPEC_CAPABILITY_SLUG:-}"
OPENSPEC_MASTERPLAN_LABEL_RAW="${GUARDEX_OPENSPEC_MASTERPLAN_LABEL-masterplan}"
OPENSPEC_TIER_RAW="${GUARDEX_OPENSPEC_TIER:-}"
OPENSPEC_TIER=""
OPENSPEC_SKIP_CHANGE=0
OPENSPEC_SKIP_PLAN=0
OPENSPEC_MINIMAL=0
TASK_MODE=""
TASK_ROUTING_REASON=""

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
  echo "[codex-agent] Guardex CLI entrypoint unavailable; rerun via gx." >&2
  return 127
}

normalize_bool() {
  local raw="${1:-}"
  local fallback="${2:-0}"
  local lowered
  lowered="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$lowered" in
    1|true|yes|on) printf '1' ;;
    0|false|no|off) printf '0' ;;
    '') printf '%s' "$fallback" ;;
    *) printf '%s' "$fallback" ;;
  esac
}

normalize_tier() {
  local raw="${1:-}"
  local fallback="${2:-T2}"
  local upper
  upper="$(printf '%s' "$raw" | tr '[:lower:]' '[:upper:]')"
  case "$upper" in
    T0|T1|T2|T3) printf '%s' "$upper" ;;
    '') printf '%s' "$fallback" ;;
    *) return 1 ;;
  esac
}

codex_args_include_approval_policy() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      -a|--ask-for-approval|--approval-policy|--dangerously-bypass-approvals-and-sandbox)
        return 0
        ;;
      --ask-for-approval=*|--approval-policy=*)
        return 0
        ;;
    esac
  done
  return 1
}

build_codex_launch_args() {
  CODEX_LAUNCH_ARGS=()
  if [[ -n "$CODEX_APPROVAL_POLICY" ]] && ! codex_args_include_approval_policy "$@"; then
    CODEX_LAUNCH_ARGS+=("-a" "$CODEX_APPROVAL_POLICY")
  fi
  CODEX_LAUNCH_ARGS+=("$@")
}

string_contains_any() {
  local haystack="$1"
  shift
  local needle
  for needle in "$@"; do
    if [[ "$haystack" == *"$needle"* ]]; then
      return 0
    fi
  done
  return 1
}

string_has_lightweight_prefix() {
  local text="$1"
  local prefix
  for prefix in "quick:" "simple:" "tiny:" "minor:" "small:" "just:" "only:"; do
    if [[ "$text" == "$prefix"* ]]; then
      return 0
    fi
  done
  return 1
}

task_requires_full_change_workspace() {
  local text="$1"
  string_contains_any "$text" \
    "cleanup evidence" "merged cleanup" "merged state" "pr url" \
    "cleanup pipeline" "finish pipeline" "sandbox cleanup" "tasks.md"
}

derive_task_mode_from_tier() {
  case "$1" in
    T0|T1) printf 'caveman' ;;
    T2|T3) printf 'omx' ;;
    *) return 1 ;;
  esac
}

apply_openspec_tier() {
  OPENSPEC_SKIP_CHANGE=0
  OPENSPEC_SKIP_PLAN=0
  OPENSPEC_MINIMAL=0
  case "$1" in
    T0)
      OPENSPEC_SKIP_CHANGE=1
      OPENSPEC_SKIP_PLAN=1
      ;;
    T1)
      OPENSPEC_SKIP_PLAN=1
      OPENSPEC_MINIMAL=1
      ;;
    T2)
      OPENSPEC_SKIP_PLAN=1
      ;;
  esac
}

decide_task_routing() {
  local task_lower
  task_lower="$(printf '%s' "$TASK_NAME" | tr '[:upper:]' '[:lower:]')"

  if [[ -n "$OPENSPEC_TIER_RAW" ]]; then
    if ! OPENSPEC_TIER="$(normalize_tier "$OPENSPEC_TIER_RAW" "T2")"; then
      echo "[codex-agent] Unsupported OpenSpec tier: ${OPENSPEC_TIER_RAW}" >&2
      return 1
    fi
    TASK_ROUTING_REASON="explicit tier override"
  elif string_has_lightweight_prefix "$task_lower"; then
    if task_requires_full_change_workspace "$task_lower"; then
      OPENSPEC_TIER="T2"
      TASK_ROUTING_REASON="cleanup-evidence artifact wording overrides lightweight prefix"
    else
      OPENSPEC_TIER="T1"
      TASK_ROUTING_REASON="explicit lightweight prefix"
    fi
  elif string_contains_any "$task_lower" \
    "ralph" "autopilot" "ultrawork" "ultraqa" "ralplan" "deep interview" "ouroboros" \
    "migration" "refactor" "architecture" "re-architect" "cross-cutting" "multi-agent" \
    "multiagent" "parallel" "orchestr" "release" "zero-copy" "install surface" "workflow"
  then
    OPENSPEC_TIER="T3"
    TASK_ROUTING_REASON="plan-heavy or orchestration-heavy task wording"
  elif string_contains_any "$task_lower" \
    "typo" "spelling" "comment-only" "comment only" "format-only" "format only" \
    "whitespace" "one-liner" "one liner" "version bump" "bump version" \
    "single-file" "single file"
  then
    OPENSPEC_TIER="T1"
    TASK_ROUTING_REASON="small bounded maintenance wording"
  else
    OPENSPEC_TIER="T2"
    TASK_ROUTING_REASON="default behavior-change route"
  fi

  if ! TASK_MODE="$(derive_task_mode_from_tier "$OPENSPEC_TIER")"; then
    echo "[codex-agent] Unsupported task mode tier: ${OPENSPEC_TIER}" >&2
    return 1
  fi
  apply_openspec_tier "$OPENSPEC_TIER"
}

describe_task_routing() {
  case "$OPENSPEC_TIER" in
    T0) printf 'caveman / T0 (no OpenSpec scaffold)' ;;
    T1) printf 'caveman / T1 (notes-only OpenSpec)' ;;
    T2) printf 'omx / T2 (change workspace only)' ;;
    T3) printf 'omx / T3 (change plus plan workspace)' ;;
    *) printf 'unknown / %s' "${OPENSPEC_TIER:-unset}" ;;
  esac
}

AUTO_FINISH="$(normalize_bool "$AUTO_FINISH_RAW" "1")"
AUTO_REVIEW_ON_CONFLICT="$(normalize_bool "$AUTO_REVIEW_ON_CONFLICT_RAW" "1")"
AUTO_CLEANUP="$(normalize_bool "$AUTO_CLEANUP_RAW" "1")"
AUTO_WAIT_FOR_MERGE="$(normalize_bool "$AUTO_WAIT_FOR_MERGE_RAW" "1")"
OPENSPEC_AUTO_INIT="$(normalize_bool "$OPENSPEC_AUTO_INIT_RAW" "1")"

resolve_openspec_masterplan_label() {
  local raw="${OPENSPEC_MASTERPLAN_LABEL_RAW:-}"
  local label

  if [[ "$OPENSPEC_AUTO_INIT" -ne 1 ]] || [[ "$OPENSPEC_SKIP_PLAN" -eq 1 ]] || [[ -z "$raw" ]]; then
    printf ''
    return 0
  fi

  label="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g')"
  printf '%s' "$label"
}

if [[ -n "$BASE_BRANCH" ]]; then
  BASE_BRANCH_EXPLICIT=1
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task)
      TASK_NAME="${2:-$TASK_NAME}"
      shift 2
      ;;
    --agent)
      AGENT_NAME="${2:-$AGENT_NAME}"
      shift 2
      ;;
    --base)
      BASE_BRANCH="${2:-$BASE_BRANCH}"
      BASE_BRANCH_EXPLICIT=1
      shift 2
      ;;
    --tier)
      OPENSPEC_TIER_RAW="${2:-$OPENSPEC_TIER_RAW}"
      shift 2
      ;;
    --codex-bin)
      CODEX_BIN="${2:-$CODEX_BIN}"
      shift 2
      ;;
    --auto-finish)
      AUTO_FINISH=1
      shift
      ;;
    --no-auto-finish)
      AUTO_FINISH=0
      shift
      ;;
    --auto-review-on-conflict)
      AUTO_REVIEW_ON_CONFLICT=1
      shift
      ;;
    --no-auto-review-on-conflict)
      AUTO_REVIEW_ON_CONFLICT=0
      shift
      ;;
    --cleanup)
      AUTO_CLEANUP=1
      shift
      ;;
    --no-cleanup)
      AUTO_CLEANUP=0
      shift
      ;;
    --wait-for-merge)
      AUTO_WAIT_FOR_MERGE=1
      shift
      ;;
    --no-wait-for-merge)
      AUTO_WAIT_FOR_MERGE=0
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      break
      ;;
    *)
      TASK_NAME="$1"
      shift
      if [[ $# -gt 0 && "${1:-}" != -* ]]; then
        AGENT_NAME="$1"
        shift
      fi
      if [[ $# -gt 0 && "${1:-}" != -* ]]; then
        BASE_BRANCH="$1"
        BASE_BRANCH_EXPLICIT=1
        shift
      fi
      break
      ;;
  esac
done

if [[ "$BASE_BRANCH_EXPLICIT" -eq 1 && -z "$BASE_BRANCH" ]]; then
  echo "[codex-agent] --base requires a non-empty branch name." >&2
  exit 1
fi

if ! decide_task_routing; then
  exit 1
fi

if ! command -v "$CODEX_BIN" >/dev/null 2>&1; then
  echo "[codex-agent] Missing Codex CLI command: $CODEX_BIN" >&2
  echo "[codex-agent] Install Codex first, then retry." >&2
  exit 127
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[codex-agent] Not inside a git repository." >&2
  exit 1
fi
repo_root="$(git rev-parse --show-toplevel)"
active_session_state_script="${repo_root}/scripts/agent-session-state.js"

guardex_env_helper="${repo_root}/scripts/guardex-env.sh"
if [[ -f "$guardex_env_helper" ]]; then
  # shellcheck source=/dev/null
  source "$guardex_env_helper"
fi
if declare -F guardex_repo_is_enabled >/dev/null 2>&1 && ! guardex_repo_is_enabled "$repo_root"; then
  toggle_source="$(guardex_repo_toggle_source "$repo_root" || true)"
  toggle_raw="$(guardex_repo_toggle_raw "$repo_root" || true)"
  if [[ -n "$toggle_source" && -n "$toggle_raw" ]]; then
    echo "[codex-agent] Guardex is disabled for this repo (${toggle_source}: GUARDEX_ON=${toggle_raw})." >&2
  else
    echo "[codex-agent] Guardex is disabled for this repo." >&2
  fi
  echo "[codex-agent] Skip Guardex sandbox flow or re-enable with GUARDEX_ON=1." >&2
  exit 1
fi

sanitize_slug() {
  local raw="$1"
  local fallback="${2:-task}"
  local slug
  slug="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g')"
  if [[ -z "$slug" ]]; then
    slug="$fallback"
  fi
  printf '%s' "$slug"
}

resolve_openspec_plan_slug() {
  local branch_name="$1"
  local task_slug
  local masterplan_label=""
  local branch_role=""
  local branch_leaf=""
  task_slug="$(sanitize_slug "$TASK_NAME" "task")"
  if [[ -n "$OPENSPEC_PLAN_SLUG_OVERRIDE" ]]; then
    sanitize_slug "$OPENSPEC_PLAN_SLUG_OVERRIDE" "$task_slug"
    return 0
  fi
  masterplan_label="$(resolve_openspec_masterplan_label)"
  if [[ -n "$masterplan_label" ]] && [[ "$branch_name" =~ ^agent/([^/]+)/(.+)$ ]]; then
    branch_role="${BASH_REMATCH[1]}"
    branch_leaf="${BASH_REMATCH[2]}"
    sanitize_slug "agent-${branch_role}-${masterplan_label}-${branch_leaf}" "$task_slug"
    return 0
  fi
  sanitize_slug "${branch_name//\//-}" "$task_slug"
}

resolve_openspec_change_slug() {
  local branch_name="$1"
  local task_slug
  task_slug="$(sanitize_slug "$TASK_NAME" "task")"
  if [[ -n "$OPENSPEC_CHANGE_SLUG_OVERRIDE" ]]; then
    sanitize_slug "$OPENSPEC_CHANGE_SLUG_OVERRIDE" "$task_slug"
    return 0
  fi
  sanitize_slug "${branch_name//\//-}" "$task_slug"
}

resolve_openspec_capability_slug() {
  local task_slug
  task_slug="$(sanitize_slug "$TASK_NAME" "task")"
  if [[ -n "$OPENSPEC_CAPABILITY_SLUG_OVERRIDE" ]]; then
    sanitize_slug "$OPENSPEC_CAPABILITY_SLUG_OVERRIDE" "$task_slug"
    return 0
  fi
  sanitize_slug "$task_slug" "general-behavior"
}

resolve_repo_prefix() {
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  basename "$root"
}

resolve_worktree_leaf() {
  local branch_name="$1"
  local masterplan_label=""
  local branch_role=""
  local branch_leaf=""
  local repo_prefix
  repo_prefix="$(resolve_repo_prefix)"

  masterplan_label="$(resolve_openspec_masterplan_label)"
  if [[ -n "$masterplan_label" ]] && [[ "$branch_name" =~ ^agent/([^/]+)/(.+)$ ]]; then
    branch_role="${BASH_REMATCH[1]}"
    branch_leaf="${BASH_REMATCH[2]}"
    printf '%s__%s__%s__%s' "$repo_prefix" "$branch_role" "$masterplan_label" "$branch_leaf"
    return 0
  fi

  if [[ "$branch_name" =~ ^agent/([^/]+)/(.+)$ ]]; then
    branch_role="${BASH_REMATCH[1]}"
    branch_leaf="${BASH_REMATCH[2]}"
    printf '%s__%s__%s' "$repo_prefix" "$branch_role" "$branch_leaf"
    return 0
  fi

  printf '%s' "${branch_name//\//__}"
}

hydrate_local_helper_in_worktree() {
  local worktree="$1"
  local relative_path="$2"
  local worktree_target="${worktree}/${relative_path}"
  local source_path=""

  if [[ -e "$worktree_target" ]]; then
    return 0
  fi

  if [[ -f "${repo_root}/${relative_path}" ]]; then
    source_path="${repo_root}/${relative_path}"
  elif [[ -f "${repo_root}/templates/${relative_path}" ]]; then
    source_path="${repo_root}/templates/${relative_path}"
  fi

  if [[ -z "$source_path" ]]; then
    return 0
  fi

  mkdir -p "$(dirname "$worktree_target")"
  cp "$source_path" "$worktree_target"
  if [[ -x "$source_path" ]]; then
    chmod +x "$worktree_target"
  fi

  echo "[codex-agent] Hydrated local helper in sandbox: ${relative_path}"
}

resolve_start_base_branch() {
  if [[ "$BASE_BRANCH_EXPLICIT" -eq 1 && -n "$BASE_BRANCH" ]]; then
    printf '%s' "$BASE_BRANCH"
    return 0
  fi

  local configured_base
  configured_base="$(git -C "$repo_root" config --get multiagent.baseBranch || true)"
  if [[ -n "$configured_base" ]]; then
    printf '%s' "$configured_base"
    return 0
  fi

  printf 'dev'
}

resolve_start_ref() {
  local base_branch="$1"
  git -C "$repo_root" fetch origin "$base_branch" --quiet >/dev/null 2>&1 || true
  if git -C "$repo_root" show-ref --verify --quiet "refs/remotes/origin/${base_branch}"; then
    printf 'origin/%s' "$base_branch"
    return 0
  fi
  if git -C "$repo_root" show-ref --verify --quiet "refs/heads/${base_branch}"; then
    printf '%s' "$base_branch"
    return 0
  fi
  return 1
}

origin_remote_looks_like_github() {
  local wt="$1"
  local origin_url=""
  origin_url="$(git -C "$wt" remote get-url origin 2>/dev/null || true)"
  [[ -n "$origin_url" && "$origin_url" =~ github\.com[:/] ]]
}

auto_finish_context_is_ready() {
  local wt="$1"
  local gh_bin="${GUARDEX_GH_BIN:-gh}"

  if ! git -C "$wt" remote get-url origin >/dev/null 2>&1; then
    return 1
  fi
  if ! command -v "$gh_bin" >/dev/null 2>&1; then
    return 1
  fi

  if [[ -n "${GUARDEX_GH_BIN:-}" ]]; then
    return 0
  fi

  if ! origin_remote_looks_like_github "$wt"; then
    return 1
  fi

  "$gh_bin" auth status >/dev/null 2>&1
}

restore_repo_branch_if_changed() {
  local expected_branch="$1"
  if [[ -z "$expected_branch" || "$expected_branch" == "HEAD" ]]; then
    return 0
  fi
  local current_branch
  current_branch="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [[ -z "$current_branch" || "$current_branch" == "$expected_branch" ]]; then
    return 0
  fi
  git -C "$repo_root" checkout "$expected_branch" >/dev/null 2>&1
}

start_sandbox_fallback() {
  local base_branch start_ref timestamp task_slug agent_slug branch_name_base branch_name suffix
  local worktree_root worktree_path

  base_branch="$(resolve_start_base_branch)"
  if ! start_ref="$(resolve_start_ref "$base_branch")"; then
    echo "[codex-agent] Unable to resolve base ref for fallback sandbox start: ${base_branch}" >&2
    return 1
  fi

  timestamp="$(date +%Y%m%d-%H%M%S)"
  task_slug="$(sanitize_slug "$TASK_NAME" "task")"
  agent_slug="$(sanitize_slug "$AGENT_NAME" "agent")"
  branch_name_base="agent/${agent_slug}/${timestamp}-${task_slug}"
  branch_name="$branch_name_base"
  suffix=2
  while git -C "$repo_root" show-ref --verify --quiet "refs/heads/${branch_name}"; do
    branch_name="${branch_name_base}-${suffix}"
    suffix=$((suffix + 1))
  done

  worktree_root="${repo_root}/.omx/agent-worktrees"
  mkdir -p "$worktree_root"
  worktree_path="${worktree_root}/$(resolve_worktree_leaf "$branch_name")"
  if [[ -e "$worktree_path" ]]; then
    echo "[codex-agent] Fallback worktree path already exists: $worktree_path" >&2
    return 1
  fi

  local worktree_add_output=""
  if ! worktree_add_output="$(git -C "$repo_root" worktree add -b "$branch_name" "$worktree_path" "$start_ref" 2>&1)"; then
    printf '%s\n' "$worktree_add_output" >&2
    return 1
  fi
  git -C "$repo_root" config "branch.${branch_name}.guardexBase" "$base_branch" >/dev/null 2>&1 || true
  git -C "$worktree_path" branch --unset-upstream "$branch_name" >/dev/null 2>&1 || true

  printf '[agent-branch-start] Created branch: %s\n' "$branch_name"
  printf '[agent-branch-start] Worktree: %s\n' "$worktree_path"
}

start_args=(--tier "$OPENSPEC_TIER" "$TASK_NAME" "$AGENT_NAME")
if [[ "$BASE_BRANCH_EXPLICIT" -eq 1 ]]; then
  start_args+=("$BASE_BRANCH")
fi

initial_repo_branch="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
start_output=""
start_status=0
set +e
start_output="$(
  GUARDEX_OPENSPEC_AUTO_INIT="$OPENSPEC_AUTO_INIT" \
  GUARDEX_OPENSPEC_MASTERPLAN_LABEL="$OPENSPEC_MASTERPLAN_LABEL_RAW" \
  run_guardex_cli branch start "${start_args[@]}" 2>&1
)"
start_status=$?
set -e

worktree_path="$(printf '%s\n' "$start_output" | sed -n 's/^\[agent-branch-start\] Worktree: //p' | tail -n1)"
current_repo_branch="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
resolved_repo_root="$(cd "$repo_root" && pwd -P)"
resolved_worktree_path=""
if [[ -n "$worktree_path" && -d "$worktree_path" ]]; then
  resolved_worktree_path="$(cd "$worktree_path" && pwd -P)"
fi

fallback_reason=""
if [[ "$start_status" -ne 0 ]]; then
  fallback_reason="starter exited with status ${start_status}"
elif [[ -z "$worktree_path" ]]; then
  fallback_reason="starter did not report worktree path"
elif [[ -n "$resolved_worktree_path" && "$resolved_worktree_path" == "$resolved_repo_root" ]]; then
  fallback_reason="starter pointed to active checkout path"
elif [[ -n "$initial_repo_branch" && -n "$current_repo_branch" && "$current_repo_branch" != "$initial_repo_branch" ]]; then
  fallback_reason="starter switched active checkout branch"
fi

if [[ -n "$fallback_reason" ]]; then
  if ! restore_repo_branch_if_changed "$initial_repo_branch"; then
    echo "[codex-agent] agent-branch-start changed the active checkout branch and restore failed." >&2
    echo "[codex-agent] Run 'gx setup --target ${repo_root}' and 'gx doctor --target ${repo_root}', then retry." >&2
    exit 1
  fi
  if [[ -n "$start_output" ]]; then
    printf '%s\n' "$start_output" >&2
  fi
  echo "[codex-agent] Unsafe starter output (${fallback_reason}); creating sandbox worktree directly." >&2
  start_output="$(start_sandbox_fallback)"
  printf '%s\n' "$start_output"
  worktree_path="$(printf '%s\n' "$start_output" | sed -n 's/^\[agent-branch-start\] Worktree: //p' | tail -n1)"
else
  printf '%s\n' "$start_output"
fi

if [[ -z "$worktree_path" ]]; then
  echo "[codex-agent] Could not determine sandbox worktree path from sandbox startup output." >&2
  echo "[codex-agent] Run 'gx setup --target ${repo_root}' and 'gx doctor --target ${repo_root}', then retry." >&2
  exit 1
fi

if [[ ! -d "$worktree_path" ]]; then
  echo "[codex-agent] Reported worktree path does not exist: $worktree_path" >&2
  exit 1
fi

has_origin_remote() {
  git -C "$repo_root" remote get-url origin >/dev/null 2>&1
}

run_active_session_state() {
  local action="$1"
  shift

  if [[ ! -f "$active_session_state_script" ]]; then
    return 0
  fi
  if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
    return 0
  fi

  "$NODE_BIN" "$active_session_state_script" "$action" "$@" >/dev/null 2>&1 || true
}

record_active_session_state() {
  local wt="$1"
  local branch="$2"

  run_active_session_state \
    start \
    --repo "$repo_root" \
    --branch "$branch" \
    --task "$TASK_NAME" \
    --agent "$AGENT_NAME" \
    --worktree "$wt" \
    --pid "$$" \
    --cli "$CODEX_BIN" \
    --task-mode "$TASK_MODE" \
    --openspec-tier "$OPENSPEC_TIER" \
    --routing-reason "$TASK_ROUTING_REASON"
}

clear_active_session_state() {
  local branch="$1"
  run_active_session_state stop --repo "$repo_root" --branch "$branch"
}

heartbeat_active_session_state() {
  local branch="$1"
  run_active_session_state heartbeat --repo "$repo_root" --branch "$branch" --state working
}

normalize_heartbeat_interval_seconds() {
  local raw="${GUARDEX_ACTIVE_SESSION_HEARTBEAT_INTERVAL_SECONDS:-15}"
  if [[ "$raw" =~ ^[0-9]+$ ]] && [[ "$raw" -ge 1 ]]; then
    printf '%s' "$raw"
    return 0
  fi
  printf '15'
}

start_active_session_heartbeat() {
  local branch="$1"
  local interval
  interval="$(normalize_heartbeat_interval_seconds)"
  (
    while true; do
      sleep "$interval" || break
      heartbeat_active_session_state "$branch"
    done
  ) &
  active_session_heartbeat_pid="$!"
}

stop_active_session_heartbeat() {
  if [[ -n "${active_session_heartbeat_pid:-}" ]]; then
    kill "$active_session_heartbeat_pid" >/dev/null 2>&1 || true
    wait "$active_session_heartbeat_pid" >/dev/null 2>&1 || true
    active_session_heartbeat_pid=""
  fi
}

origin_remote_supports_pr_finish() {
  local origin_url
  origin_url="$(git -C "$repo_root" remote get-url origin 2>/dev/null || true)"
  case "$origin_url" in
    ''|/*|./*|../*|file://*)
      return 1
      ;;
  esac
  return 0
}

resolve_worktree_base_branch() {
  local _wt="$1"
  if [[ "$BASE_BRANCH_EXPLICIT" -eq 1 && -n "$BASE_BRANCH" ]]; then
    printf '%s' "$BASE_BRANCH"
    return 0
  fi

  local configured_base
  configured_base="$(git -C "$repo_root" config --get multiagent.baseBranch || true)"
  if [[ -n "$configured_base" ]]; then
    printf '%s' "$configured_base"
    return 0
  fi

  printf 'dev'
}

print_takeover_prompt() {
  local wt="$1"
  local branch="$2"
  local base_branch change_slug change_artifact finish_cmd

  base_branch="$(resolve_worktree_base_branch "$wt")"
  if [[ -z "$base_branch" ]]; then
    base_branch="dev"
  fi

  change_slug="$(resolve_openspec_change_slug "$branch")"
  change_artifact="openspec/changes/${change_slug}/tasks.md"
  if [[ ! -f "${wt}/${change_artifact}" ]]; then
    change_artifact="openspec/changes/${change_slug}/notes.md"
  fi
  if [[ ! -f "${wt}/${change_artifact}" ]]; then
    change_artifact="openspec/changes/${change_slug}/"
  fi

  finish_cmd="gx branch finish --branch \"${branch}\" --base ${base_branch} --via-pr --wait-for-merge --cleanup"

  echo "[codex-agent] Resume this sandbox:"
  echo "  change:   ${change_slug}"
  echo "  branch:   ${branch}"
  echo "  worktree: ${wt}"
  echo "  spec:     ${change_artifact}"
  echo "  routing:  $(describe_task_routing) (${TASK_ROUTING_REASON})"
  echo "  rule:     continue current state; do not create a new sandbox"
  echo "  finish:   ${finish_cmd}"
}

sync_worktree_with_base() {
  local wt="$1"
  if ! has_origin_remote; then
    return 0
  fi

  local base_branch
  base_branch="$(resolve_worktree_base_branch "$wt")"
  if [[ -z "$base_branch" ]]; then
    return 0
  fi

  if ! git -C "$wt" fetch origin "$base_branch" --quiet; then
    echo "[codex-agent] Warning: could not fetch origin/${base_branch} before task start." >&2
    return 0
  fi

  if ! git -C "$wt" show-ref --verify --quiet "refs/remotes/origin/${base_branch}"; then
    return 0
  fi

  local behind_count
  behind_count="$(git -C "$wt" rev-list --left-right --count "HEAD...origin/${base_branch}" 2>/dev/null | awk '{print $2}')"
  behind_count="${behind_count:-0}"
  if [[ "$behind_count" -le 0 ]]; then
    return 0
  fi

  local branch
  branch="$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  echo "[codex-agent] Task sync: '${branch}' is behind origin/${base_branch} by ${behind_count} commit(s). Rebasing before launch..."
  if ! git -C "$wt" rebase "origin/${base_branch}"; then
    echo "[codex-agent] Task sync failed. Resolve and continue in sandbox:" >&2
    echo "  git -C \"$wt\" rebase --continue" >&2
    echo "  # or abort" >&2
    echo "  git -C \"$wt\" rebase --abort" >&2
    return 1
  fi
  echo "[codex-agent] Task sync complete."
  return 0
}

ensure_openspec_plan_workspace() {
  local wt="$1"
  local branch="$2"

  if [[ "$OPENSPEC_AUTO_INIT" -ne 1 ]] || [[ "$OPENSPEC_SKIP_PLAN" -eq 1 ]]; then
    return 0
  fi

  local plan_slug
  plan_slug="$(resolve_openspec_plan_slug "$branch")"
  local init_output=""
  if ! init_output="$(
    cd "$wt"
    run_guardex_cli internal run-shell planInit "$plan_slug" 2>&1
  )"; then
    printf '%s\n' "$init_output" >&2
    echo "[codex-agent] OpenSpec workspace initialization failed for plan '${plan_slug}'." >&2
    return 1
  fi
  if [[ -n "$init_output" ]]; then
    printf '%s\n' "$init_output"
  fi
  echo "[codex-agent] OpenSpec plan workspace: ${wt}/openspec/plan/${plan_slug}"
}

ensure_openspec_change_workspace() {
  local wt="$1"
  local branch="$2"

  if [[ "$OPENSPEC_AUTO_INIT" -ne 1 ]] || [[ "$OPENSPEC_SKIP_CHANGE" -eq 1 ]]; then
    return 0
  fi

  local change_slug capability_slug init_output=""
  change_slug="$(resolve_openspec_change_slug "$branch")"
  capability_slug="$(resolve_openspec_capability_slug)"
  if ! init_output="$(
    cd "$wt"
    GUARDEX_OPENSPEC_MINIMAL="$OPENSPEC_MINIMAL" \
      run_guardex_cli internal run-shell changeInit "$change_slug" "$capability_slug" 2>&1
  )"; then
    printf '%s\n' "$init_output" >&2
    echo "[codex-agent] OpenSpec workspace initialization failed for change '${change_slug}'." >&2
    return 1
  fi
  if [[ -n "$init_output" ]]; then
    printf '%s\n' "$init_output"
  fi
  echo "[codex-agent] OpenSpec change workspace: ${wt}/openspec/changes/${change_slug}"
}

worktree_has_changes() {
  local wt="$1"
  if ! git -C "$wt" diff --quiet -- . ":(exclude).omx/state/agent-file-locks.json"; then
    return 0
  fi
  if ! git -C "$wt" diff --cached --quiet -- . ":(exclude).omx/state/agent-file-locks.json"; then
    return 0
  fi
  if [[ -n "$(git -C "$wt" ls-files --others --exclude-standard)" ]]; then
    return 0
  fi
  return 1
}

claim_changed_files() {
  local wt="$1"
  local branch="$2"

  local changed_raw deleted_raw
  changed_raw="$({
    git -C "$wt" diff --name-only -- . ":(exclude).omx/state/agent-file-locks.json";
    git -C "$wt" diff --cached --name-only -- . ":(exclude).omx/state/agent-file-locks.json";
    git -C "$wt" ls-files --others --exclude-standard;
  } | sed '/^$/d' | sort -u)"

  if [[ -n "$changed_raw" ]]; then
    mapfile -t changed_files < <(printf '%s\n' "$changed_raw")
    run_guardex_cli locks claim --branch "$branch" "${changed_files[@]}" >/dev/null 2>&1 || true
  fi

  deleted_raw="$({
    git -C "$wt" diff --name-only --diff-filter=D -- . ":(exclude).omx/state/agent-file-locks.json";
    git -C "$wt" diff --cached --name-only --diff-filter=D -- . ":(exclude).omx/state/agent-file-locks.json";
  } | sed '/^$/d' | sort -u)"

  if [[ -n "$deleted_raw" ]]; then
    mapfile -t deleted_files < <(printf '%s\n' "$deleted_raw")
    run_guardex_cli locks allow-delete --branch "$branch" "${deleted_files[@]}" >/dev/null 2>&1 || true
  fi
}

auto_commit_worktree_changes() {
  local wt="$1"
  local branch="$2"

  if ! worktree_has_changes "$wt"; then
    return 0
  fi

  claim_changed_files "$wt" "$branch"
  git -C "$wt" add -A

  if git -C "$wt" diff --cached --quiet -- . ":(exclude).omx/state/agent-file-locks.json"; then
    return 0
  fi

  local default_message="Auto-finish: ${TASK_NAME}"
  local commit_message="${GUARDEX_CODEX_AUTO_COMMIT_MESSAGE:-$default_message}"
  local commit_output=""

  if commit_output="$(git -C "$wt" commit -m "$commit_message" 2>&1)"; then
    echo "[codex-agent] Auto-committed sandbox changes on '${branch}'."
    return 0
  fi

  if auto_sync_for_commit_retry "$wt" "$branch"; then
    claim_changed_files "$wt" "$branch"
    git -C "$wt" add -A
    if commit_output="$(git -C "$wt" commit -m "$commit_message" 2>&1)"; then
      echo "[codex-agent] Auto-committed sandbox changes on '${branch}' after sync retry."
      return 0
    fi
  fi

  echo "[codex-agent] Auto-commit failed in sandbox. Keeping branch for manual review: $branch" >&2
  if [[ -n "$commit_output" ]]; then
    printf '%s\n' "$commit_output" >&2
  fi
  return 1
}

auto_sync_for_commit_retry() {
  local wt="$1"
  local branch="$2"

  if ! has_origin_remote; then
    return 1
  fi

  local base_branch
  base_branch="$(resolve_worktree_base_branch "$wt")"
  if [[ -z "$base_branch" ]]; then
    return 1
  fi

  if ! git -C "$wt" fetch origin "$base_branch" --quiet; then
    return 1
  fi

  if ! git -C "$wt" show-ref --verify --quiet "refs/remotes/origin/${base_branch}"; then
    return 1
  fi

  local behind_count
  behind_count="$(git -C "$wt" rev-list --left-right --count "HEAD...origin/${base_branch}" 2>/dev/null | awk '{print $2}')"
  behind_count="${behind_count:-0}"
  if [[ "$behind_count" -le 0 ]]; then
    return 1
  fi

  echo "[codex-agent] Auto-commit retry: '${branch}' is behind origin/${base_branch} by ${behind_count} commit(s). Syncing and retrying..."

  local stash_ref=""
  local stash_output=""
  if worktree_has_changes "$wt"; then
    if ! stash_output="$(git -C "$wt" stash push --include-untracked -m "codex-agent-autocommit-sync-${branch}-$(date +%s)" 2>&1)"; then
      return 1
    fi
    stash_ref="$(printf '%s\n' "$stash_output" | grep -o 'stash@{[0-9]\+}' | head -n 1 || true)"
  fi

  if ! git -C "$wt" rebase "origin/${base_branch}" >/dev/null 2>&1; then
    git -C "$wt" rebase --abort >/dev/null 2>&1 || true
    if [[ -n "$stash_ref" ]]; then
      git -C "$wt" stash pop "$stash_ref" >/dev/null 2>&1 || true
    fi
    return 1
  fi

  if [[ -n "$stash_ref" ]]; then
    if ! git -C "$wt" stash pop "$stash_ref" >/dev/null 2>&1; then
      echo "[codex-agent] Auto-commit retry could not re-apply local changes after sync. Manual resolution required in: $wt" >&2
      return 1
    fi
  fi

  return 0
}

looks_like_conflict_failure() {
  local output="$1"
  if grep -qiE 'preflight conflict detected|merge conflict detected|auto-sync failed while rebasing|rebase --continue|rebase --abort' <<< "$output"; then
    return 0
  fi
  return 1
}

run_finish_flow() {
  local wt="$1"
  local branch="$2"
  local finish_base_branch=""
  local finish_output=""
  local -a finish_args

  finish_args=(--branch "$branch")
  if [[ "$BASE_BRANCH_EXPLICIT" -eq 1 && -n "$BASE_BRANCH" ]]; then
    finish_base_branch="$BASE_BRANCH"
  else
    finish_base_branch="$(resolve_worktree_base_branch "$wt")"
  fi
  if [[ -n "$finish_base_branch" ]]; then
    finish_args+=(--base "$finish_base_branch")
  fi
  if [[ "$AUTO_CLEANUP" -eq 1 ]]; then
    finish_args+=(--cleanup)
  fi
  if [[ "$AUTO_WAIT_FOR_MERGE" -eq 1 ]]; then
    finish_args+=(--wait-for-merge)
  fi

  if has_origin_remote; then
    if ! command -v "${GUARDEX_GH_BIN:-gh}" >/dev/null 2>&1 && ! command -v gh >/dev/null 2>&1; then
      echo "[codex-agent] Auto-finish requires GitHub CLI for PR flow; command not found: ${GUARDEX_GH_BIN:-gh}" >&2
      return 2
    fi
    if origin_remote_supports_pr_finish; then
      finish_args+=(--via-pr)
    else
      echo "[codex-agent] Origin remote does not provide a mergeable PR surface; skipping auto-finish merge/PR pipeline." >&2
      return 2
    fi
  else
    echo "[codex-agent] No origin remote detected; skipping auto-finish merge/PR pipeline." >&2
    return 2
  fi

  if finish_output="$(run_guardex_cli branch finish "${finish_args[@]}" 2>&1)"; then
    printf '%s\n' "$finish_output"
    return 0
  fi

  printf '%s\n' "$finish_output" >&2

  if [[ "$AUTO_REVIEW_ON_CONFLICT" -eq 1 ]] && looks_like_conflict_failure "$finish_output"; then
    echo "[codex-agent] Auto-finish hit conflicts. Launching Codex conflict-review pass in sandbox..." >&2
    local review_prompt
    review_prompt="Resolve git conflicts for branch ${branch} against ${finish_base_branch:-dev}, then commit the resolution in this sandbox worktree and exit."

    (
      cd "$wt"
      set +e
      build_codex_launch_args "$review_prompt"
      "$CODEX_BIN" "${CODEX_LAUNCH_ARGS[@]}"
      review_exit="$?"
      set -e
      if [[ "$review_exit" -ne 0 ]]; then
        echo "[codex-agent] Conflict-review Codex pass exited with status ${review_exit}." >&2
      fi
    )

    if finish_output="$(run_guardex_cli branch finish "${finish_args[@]}" 2>&1)"; then
      printf '%s\n' "$finish_output"
      return 0
    fi

    printf '%s\n' "$finish_output" >&2
  fi

  return 1
}

if ! sync_worktree_with_base "$worktree_path"; then
  exit 1
fi

worktree_branch="$(git -C "$worktree_path" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ -z "$worktree_branch" || "$worktree_branch" == "HEAD" ]]; then
  echo "[codex-agent] Could not determine sandbox branch for worktree: $worktree_path" >&2
  exit 1
fi

if ! ensure_openspec_change_workspace "$worktree_path" "$worktree_branch"; then
  exit 1
fi

if ! ensure_openspec_plan_workspace "$worktree_path" "$worktree_branch"; then
  exit 1
fi

echo "[codex-agent] Task routing: $(describe_task_routing) (${TASK_ROUTING_REASON})"

active_session_recorded=0
active_session_heartbeat_pid=""
cleanup_active_session_state_on_exit() {
  set +e
  if [[ "${active_session_recorded:-0}" -eq 1 && -n "${worktree_branch:-}" && "${worktree_branch:-}" != "HEAD" ]]; then
    stop_active_session_heartbeat
    clear_active_session_state "$worktree_branch"
    active_session_recorded=0
  fi
}

record_active_session_state "$worktree_path" "$worktree_branch"
active_session_recorded=1
start_active_session_heartbeat "$worktree_branch"
trap cleanup_active_session_state_on_exit EXIT INT TERM

echo "[codex-agent] Launching ${CODEX_BIN} in sandbox: $worktree_path"
cd "$worktree_path"
set +e
build_codex_launch_args "$@"
GUARDEX_TASK_MODE="$TASK_MODE" \
GUARDEX_OPENSPEC_TIER="$OPENSPEC_TIER" \
GUARDEX_TASK_ROUTING_REASON="$TASK_ROUTING_REASON" \
  "$CODEX_BIN" "${CODEX_LAUNCH_ARGS[@]}"
codex_exit="$?"
set -e

cd "$repo_root"
cleanup_active_session_state_on_exit
trap - EXIT INT TERM
final_exit="$codex_exit"
auto_finish_completed=0

if [[ "$AUTO_FINISH" -eq 1 && -n "$worktree_branch" && "$worktree_branch" != "HEAD" ]]; then
  if [[ "$AUTO_WAIT_FOR_MERGE" -eq 1 && "$AUTO_CLEANUP" -eq 1 ]]; then
    echo "[codex-agent] Auto-finish enabled: commit -> push/PR -> wait for merge -> cleanup."
  elif [[ "$AUTO_WAIT_FOR_MERGE" -eq 1 ]]; then
    echo "[codex-agent] Auto-finish enabled: commit -> push/PR -> wait for merge (keep branch/worktree)."
  elif [[ "$AUTO_CLEANUP" -eq 1 ]]; then
    echo "[codex-agent] Auto-finish enabled: commit -> push/PR -> merge -> cleanup."
  else
    echo "[codex-agent] Auto-finish enabled: commit -> push/PR -> merge (keep branch/worktree)."
  fi
  if ! auto_finish_context_is_ready "$worktree_path"; then
    echo "[codex-agent] Auto-finish skipped for '${worktree_branch}' (no mergeable remote context)." >&2
  elif auto_commit_worktree_changes "$worktree_path" "$worktree_branch"; then
    if run_finish_flow "$worktree_path" "$worktree_branch"; then
      auto_finish_completed=1
      echo "[codex-agent] Auto-finish completed for '${worktree_branch}'."
    else
      finish_status="$?"
      if [[ "$finish_status" -eq 2 ]]; then
        echo "[codex-agent] Auto-finish skipped for '${worktree_branch}' (no mergeable remote context)." >&2
      else
        echo "[codex-agent] Auto-finish did not complete; keeping sandbox for manual review: $worktree_path" >&2
        if [[ "$final_exit" -eq 0 ]]; then
          final_exit=1
        fi
      fi
    fi
  else
    if [[ "$final_exit" -eq 0 ]]; then
      final_exit=1
    fi
  fi
fi

echo "[codex-agent] Session ended (exit=${codex_exit}). Running worktree cleanup..."
prune_args=()
if [[ "$BASE_BRANCH_EXPLICIT" -eq 1 ]]; then
  prune_args+=(--base "$BASE_BRANCH")
fi
if [[ "$AUTO_CLEANUP" -eq 1 && "$auto_finish_completed" -eq 1 ]]; then
  prune_args+=(--only-dirty-worktrees --delete-branches --delete-remote-branches)
fi
if ! run_guardex_cli worktree prune "${prune_args[@]}"; then
  echo "[codex-agent] Warning: automatic worktree cleanup failed." >&2
fi

if [[ ! -d "$worktree_path" ]]; then
  echo "[codex-agent] Auto-cleaned sandbox worktree: $worktree_path"
else
  worktree_branch="$(git -C "$worktree_path" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  echo "[codex-agent] Sandbox worktree kept: $worktree_path"
  if [[ -n "$worktree_branch" && "$worktree_branch" != "HEAD" ]]; then
    if [[ "$auto_finish_completed" -eq 1 ]]; then
      echo "[codex-agent] Branch kept intentionally. Cleanup on demand: gx cleanup --branch \"${worktree_branch}\""
    else
      print_takeover_prompt "$worktree_path" "$worktree_branch"
      finish_base_branch="$(resolve_worktree_base_branch "$worktree_path")"
      if [[ -z "$finish_base_branch" ]]; then
        finish_base_branch="dev"
      fi
      echo "[codex-agent] If finished, merge with: gx branch finish --branch \"${worktree_branch}\" --base ${finish_base_branch} --via-pr --wait-for-merge --cleanup"
      echo "[codex-agent] Cleanup on demand: gx cleanup --branch \"${worktree_branch}\""
    fi
  fi
fi

exit "$final_exit"
