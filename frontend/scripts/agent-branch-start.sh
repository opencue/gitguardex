#!/usr/bin/env bash
set -euo pipefail

TASK_NAME="task"
AGENT_NAME="agent"
BASE_BRANCH=""
BASE_BRANCH_EXPLICIT=0
WORKTREE_ROOT_REL=""
WORKTREE_ROOT_EXPLICIT=0
OPENSPEC_AUTO_INIT_RAW="${GUARDEX_OPENSPEC_AUTO_INIT:-false}"
OPENSPEC_PLAN_SLUG_OVERRIDE="${GUARDEX_OPENSPEC_PLAN_SLUG:-}"
OPENSPEC_CHANGE_SLUG_OVERRIDE="${GUARDEX_OPENSPEC_CHANGE_SLUG:-}"
OPENSPEC_CAPABILITY_SLUG_OVERRIDE="${GUARDEX_OPENSPEC_CAPABILITY_SLUG:-}"
OPENSPEC_MASTERPLAN_LABEL_RAW="${GUARDEX_OPENSPEC_MASTERPLAN_LABEL-masterplan}"
PRINT_NAME_ONLY=0
POSITIONAL_ARGS=()

print_usage() {
  cat <<'USAGE'
Usage: agent-branch-start [task] [agent] [base] [options]

Start an isolated agent/* branch + worktree for a task.

Positional:
  task                 Task name/slug (default: "task")
  agent                Agent name (default: "agent")
  base                 Base branch to fork from (default: repo default)

Options:
  --task <name>        Task name/slug
  --agent <name>       Agent name
  --base <branch>      Base branch to fork from
  --worktree-root <p>  Worktree root dir (default: .omx/agent-worktrees)
  --tier <T1|T2|T3>    OpenSpec tier (accepted for compatibility)
  --print-name-only    Print the computed branch name and exit
  -h, --help           Show this help and exit
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      print_usage
      exit 0
      ;;
    --task)
      TASK_NAME="${2:-task}"
      shift 2
      ;;
    --agent)
      AGENT_NAME="${2:-agent}"
      shift 2
      ;;
    --base)
      BASE_BRANCH="${2:-}"
      BASE_BRANCH_EXPLICIT=1
      shift 2
      ;;
    --print-name-only)
      PRINT_NAME_ONLY=1
      shift
      ;;
    --tier)
      # Accepted for CLAUDE.md compatibility; scaffold size is not yet wired
      # through this script. Consume the value so callers can pass it.
      shift 2
      ;;
    --in-place|--allow-in-place)
      echo "[agent-branch-start] In-place branch mode is disabled." >&2
      echo "[agent-branch-start] This command always creates an isolated worktree to keep your active checkout unchanged." >&2
      exit 1
      ;;
    --worktree-root)
      WORKTREE_ROOT_REL="${2:-.omx/agent-worktrees}"
      WORKTREE_ROOT_EXPLICIT=1
      shift 2
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        POSITIONAL_ARGS+=("$1")
        shift
      done
      break
      ;;
    -*)
      echo "[agent-branch-start] Unknown option: $1" >&2
      echo "Usage: $0 [task] [agent] [base] [--worktree-root <path>] [--print-name-only]" >&2
      exit 1
      ;;
    *)
      POSITIONAL_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ "${#POSITIONAL_ARGS[@]}" -gt 3 ]]; then
  echo "[agent-branch-start] Too many positional arguments." >&2
  echo "Usage: $0 [task] [agent] [base] [--worktree-root <path>]" >&2
  exit 1
fi

if [[ "${#POSITIONAL_ARGS[@]}" -ge 1 ]]; then
  TASK_NAME="${POSITIONAL_ARGS[0]}"
fi

if [[ "${#POSITIONAL_ARGS[@]}" -ge 2 ]]; then
  AGENT_NAME="${POSITIONAL_ARGS[1]}"
fi

if [[ "${#POSITIONAL_ARGS[@]}" -ge 3 ]]; then
  BASE_BRANCH="${POSITIONAL_ARGS[2]}"
  BASE_BRANCH_EXPLICIT=1
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

normalize_positive_int() {
  local raw="$1"
  local fallback="$2"
  if [[ "$raw" =~ ^[0-9]+$ ]] && [[ "$raw" -gt 0 ]]; then
    printf '%s' "$raw"
    return 0
  fi
  printf '%s' "$fallback"
}

shorten_slug() {
  local slug="$1"
  local raw_max="$2"
  local max_len
  max_len="$(normalize_positive_int "$raw_max" "32")"
  if [[ "${#slug}" -le "$max_len" ]]; then
    printf '%s' "$slug"
    return 0
  fi
  local shortened="${slug:0:max_len}"
  shortened="$(printf '%s' "$shortened" | sed -E 's/-+$//')"
  if [[ -z "$shortened" ]]; then
    shortened="${slug:0:max_len}"
  fi
  printf '%s' "$shortened"
}

env_flag_truthy() {
  local raw="${1:-}"
  local lowered
  lowered="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$lowered" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

default_worktree_root_rel() {
  local raw_agent="$1"
  local override="${GUARDEX_AGENT_TYPE:-}"
  local lowered_agent lowered_override
  lowered_agent="$(printf '%s' "$raw_agent" | tr '[:upper:]' '[:lower:]')"
  lowered_override="$(printf '%s' "$override" | tr '[:upper:]' '[:lower:]')"

  if [[ -n "${CLAUDE_CODE_SESSION_ID:-}" ]] || env_flag_truthy "${CLAUDECODE:-}"; then
    printf '.omc/agent-worktrees'
    return 0
  fi

  if [[ "$lowered_agent" == *claude* ]] || [[ "$lowered_override" == *claude* ]]; then
    printf '.omc/agent-worktrees'
    return 0
  fi

  printf '.omx/agent-worktrees'
}

# Collapse arbitrary agent identifiers to a clean role token. Priority:
# GUARDEX_AGENT_TYPE env override, then recognizable claude/codex aliases, then
# a small legacy compatibility set, then the literal requested role after slug
# sanitization. This preserves explicit roles such as planner/executor while
# keeping the older bot -> codex fallback stable for existing callers.
normalize_role() {
  local raw_agent="$1"
  local override="${GUARDEX_AGENT_TYPE:-}"
  if [[ -n "$override" ]]; then
    sanitize_slug "$override" "agent"
    return 0
  fi
  local lowered
  lowered="$(printf '%s' "$raw_agent" | tr '[:upper:]' '[:lower:]')"
  if [[ "$lowered" == *claude* ]]; then
    printf 'claude'
    return 0
  fi
  if [[ "$lowered" == *codex* ]]; then
    printf 'codex'
    return 0
  fi
  if [[ -n "${CLAUDECODE:-}" && "${CLAUDECODE}" != "0" && "${CLAUDECODE}" != "false" ]]; then
    printf 'claude'
    return 0
  fi
  local sanitized
  sanitized="$(sanitize_slug "$raw_agent" "codex")"
  if [[ "$sanitized" == "bot" ]]; then
    printf 'codex'
    return 0
  fi
  printf '%s' "$sanitized"
}

# Timestamp the branch/worktree/openspec slug so parallel agents never collide
# and names sort chronologically. Format: YYYY-MM-DD-HH-MM (local time).
# Colons are illegal in git refs, so the HH:MM the user sees is stored as
# HH-MM in the slug. Can be overridden for tests via GUARDEX_BRANCH_TIMESTAMP.
compose_branch_timestamp() {
  if [[ -n "${GUARDEX_BRANCH_TIMESTAMP:-}" ]]; then
    printf '%s' "$GUARDEX_BRANCH_TIMESTAMP"
    return 0
  fi
  date +%Y-%m-%d-%H-%M
}

compose_branch_descriptor() {
  local task_slug="$1"
  local stamp="$2"
  local task_max task_part
  task_max="$(normalize_positive_int "${GUARDEX_BRANCH_TASK_SLUG_MAX:-40}" "40")"
  task_part="$(shorten_slug "$task_slug" "$task_max")"
  printf '%s-%s' "$task_part" "$stamp"
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

OPENSPEC_AUTO_INIT="$(normalize_bool "$OPENSPEC_AUTO_INIT_RAW" "1")"

resolve_openspec_masterplan_label() {
  local raw="${OPENSPEC_MASTERPLAN_LABEL_RAW:-}"
  local label

  if [[ "$OPENSPEC_AUTO_INIT" -ne 1 ]] || [[ -z "$raw" ]]; then
    printf ''
    return 0
  fi

  label="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g')"
  printf '%s' "$label"
}

resolve_openspec_plan_slug() {
  local branch_name="$1"
  local agent_slug="$2"
  local task_slug="$3"
  local masterplan_label=""
  local branch_leaf=""
  if [[ -n "$OPENSPEC_PLAN_SLUG_OVERRIDE" ]]; then
    sanitize_slug "$OPENSPEC_PLAN_SLUG_OVERRIDE" "$task_slug"
    return 0
  fi
  masterplan_label="$(resolve_openspec_masterplan_label)"
  if [[ -n "$masterplan_label" ]] && [[ "$branch_name" == "agent/${agent_slug}/"* ]]; then
    branch_leaf="${branch_name#agent/${agent_slug}/}"
    sanitize_slug "agent-${agent_slug}-${masterplan_label}-${branch_leaf}" "$task_slug"
    return 0
  fi
  sanitize_slug "${branch_name//\//-}" "$task_slug"
}

resolve_openspec_change_slug() {
  local branch_name="$1"
  local task_slug="$2"
  if [[ -n "$OPENSPEC_CHANGE_SLUG_OVERRIDE" ]]; then
    sanitize_slug "$OPENSPEC_CHANGE_SLUG_OVERRIDE" "$task_slug"
    return 0
  fi
  sanitize_slug "${branch_name//\//-}" "$task_slug"
}

resolve_openspec_capability_slug() {
  local task_slug="$1"
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
  local agent_slug="$2"
  local masterplan_label=""
  local branch_leaf=""
  local repo_prefix
  repo_prefix="$(resolve_repo_prefix)"

  masterplan_label="$(resolve_openspec_masterplan_label)"
  if [[ -n "$masterplan_label" ]] && [[ "$branch_name" == "agent/${agent_slug}/"* ]]; then
    branch_leaf="${branch_name#agent/${agent_slug}/}"
    printf '%s__%s__%s__%s' "$repo_prefix" "$agent_slug" "$masterplan_label" "$branch_leaf"
    return 0
  fi

  if [[ "$branch_name" == agent/*/* ]]; then
    local without_agent="${branch_name#agent/}"
    printf '%s__%s' "$repo_prefix" "${without_agent//\//__}"
    return 0
  fi

  printf '%s' "${branch_name//\//__}"
}

has_local_changes() {
  local root="$1"
  if ! git -C "$root" diff --quiet; then
    return 0
  fi
  if ! git -C "$root" diff --cached --quiet; then
    return 0
  fi
  if [[ -n "$(git -C "$root" ls-files --others --exclude-standard)" ]]; then
    return 0
  fi
  return 1
}

resolve_stash_ref_by_message() {
  local root="$1"
  local message="$2"
  local stash_list
  stash_list="$(git -C "$root" stash list 2>/dev/null || true)"
  if [[ -z "$stash_list" ]]; then
    printf ''
    return 0
  fi

  awk -v msg="$message" '$0 ~ msg { ref=$1; sub(/:$/, "", ref); print ref; exit }' <<<"$stash_list"
}

resolve_protected_branches() {
  local root="$1"
  local raw
  raw="${GUARDEX_PROTECTED_BRANCHES:-$(git -C "$root" config --get multiagent.protectedBranches || true)}"
  if [[ -z "$raw" ]]; then
    raw="dev main master"
  fi
  raw="${raw//,/ }"
  printf '%s' "$raw"
}

is_protected_branch_name() {
  local branch="$1"
  local protected_raw="$2"
  for protected_branch in $protected_raw; do
    if [[ "$branch" == "$protected_branch" ]]; then
      return 0
    fi
  done
  return 1
}

hydrate_local_helper_in_worktree() {
  local repo="$1"
  local worktree="$2"
  local relative_path="$3"
  local worktree_target="${worktree}/${relative_path}"
  local source_path=""

  if [[ -e "$worktree_target" ]]; then
    return 0
  fi

  if [[ -f "${repo}/${relative_path}" ]]; then
    source_path="${repo}/${relative_path}"
  elif [[ -f "${repo}/templates/${relative_path}" ]]; then
    source_path="${repo}/templates/${relative_path}"
  fi

  if [[ -z "$source_path" ]]; then
    return 0
  fi

  mkdir -p "$(dirname "$worktree_target")"
  cp "$source_path" "$worktree_target"
  if [[ -x "$source_path" ]]; then
    chmod +x "$worktree_target"
  fi

  echo "[agent-branch-start] Hydrated local helper in worktree: ${relative_path}"
}

hydrate_dependency_dir_symlink_in_worktree() {
  local repo="$1"
  local worktree="$2"
  local relative_path="$3"
  local source_path="${repo}/${relative_path}"
  local target_path="${worktree}/${relative_path}"

  if [[ ! -d "$source_path" ]]; then
    return 0
  fi

  if [[ -e "$target_path" ]]; then
    return 0
  fi

  mkdir -p "$(dirname "$target_path")"
  ln -s "$source_path" "$target_path"
  echo "[agent-branch-start] Linked dependency dir in worktree: ${relative_path}"
}

initialize_openspec_plan_workspace() {
  local repo="$1"
  local worktree="$2"
  local plan_slug="$3"

  hydrate_local_helper_in_worktree "$repo" "$worktree" "scripts/openspec/init-plan-workspace.sh"

  if [[ "$OPENSPEC_AUTO_INIT" -ne 1 ]]; then
    return 0
  fi

  local openspec_script="${worktree}/scripts/openspec/init-plan-workspace.sh"
  if [[ ! -f "$openspec_script" ]]; then
    echo "[agent-branch-start] OpenSpec init script is missing in sandbox worktree." >&2
    echo "[agent-branch-start] Run 'gx setup --target \"$repo\"' to repair templates, then retry." >&2
    return 1
  fi
  if [[ ! -x "$openspec_script" ]]; then
    chmod +x "$openspec_script" 2>/dev/null || true
  fi

  local init_output=""
  if ! init_output="$(
    cd "$worktree"
    bash "scripts/openspec/init-plan-workspace.sh" "$plan_slug" 2>&1
  )"; then
    printf '%s\n' "$init_output" >&2
    echo "[agent-branch-start] OpenSpec workspace initialization failed for plan '${plan_slug}'." >&2
    return 1
  fi

  if [[ -n "$init_output" ]]; then
    printf '%s\n' "$init_output"
  fi
  echo "[agent-branch-start] OpenSpec plan workspace: ${worktree}/openspec/plan/${plan_slug}"
}

initialize_openspec_change_workspace() {
  local repo="$1"
  local worktree="$2"
  local change_slug="$3"
  local capability_slug="$4"

  hydrate_local_helper_in_worktree "$repo" "$worktree" "scripts/openspec/init-change-workspace.sh"

  if [[ "$OPENSPEC_AUTO_INIT" -ne 1 ]]; then
    return 0
  fi

  local openspec_script="${worktree}/scripts/openspec/init-change-workspace.sh"
  if [[ ! -f "$openspec_script" ]]; then
    echo "[agent-branch-start] OpenSpec change init script is missing in sandbox worktree." >&2
    echo "[agent-branch-start] Run 'gx setup --target \"$repo\"' to repair templates, then retry." >&2
    return 1
  fi
  if [[ ! -x "$openspec_script" ]]; then
    chmod +x "$openspec_script" 2>/dev/null || true
  fi

  local init_output=""
  if ! init_output="$(
    cd "$worktree"
    bash "scripts/openspec/init-change-workspace.sh" "$change_slug" "$capability_slug" 2>&1
  )"; then
    printf '%s\n' "$init_output" >&2
    echo "[agent-branch-start] OpenSpec workspace initialization failed for change '${change_slug}'." >&2
    return 1
  fi

  if [[ -n "$init_output" ]]; then
    printf '%s\n' "$init_output"
  fi
  echo "[agent-branch-start] OpenSpec change workspace: ${worktree}/openspec/changes/${change_slug}"
}

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[agent-branch-start] Not inside a git repository." >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"

guardex_env_helper="${repo_root}/scripts/guardex-env.sh"
if [[ -f "$guardex_env_helper" ]]; then
  # shellcheck source=/dev/null
  source "$guardex_env_helper"
fi
if declare -F guardex_repo_is_enabled >/dev/null 2>&1 && ! guardex_repo_is_enabled "$repo_root"; then
  toggle_source="$(guardex_repo_toggle_source "$repo_root" || true)"
  toggle_raw="$(guardex_repo_toggle_raw "$repo_root" || true)"
  if [[ -n "$toggle_source" && -n "$toggle_raw" ]]; then
    echo "[agent-branch-start] Guardex is disabled for this repo (${toggle_source}: GUARDEX_ON=${toggle_raw})." >&2
  else
    echo "[agent-branch-start] Guardex is disabled for this repo." >&2
  fi
  echo "[agent-branch-start] Skip Guardex worktree/OpenSpec flow or re-enable with GUARDEX_ON=1." >&2
  exit 1
fi

if [[ "$BASE_BRANCH_EXPLICIT" -eq 1 && -z "$BASE_BRANCH" ]]; then
  echo "[agent-branch-start] --base requires a non-empty branch name." >&2
  exit 1
fi

task_slug="$(sanitize_slug "$TASK_NAME" "task")"
agent_slug="$(normalize_role "$AGENT_NAME")"
if [[ "$WORKTREE_ROOT_EXPLICIT" -eq 0 ]]; then
  WORKTREE_ROOT_REL="$(default_worktree_root_rel "$AGENT_NAME")"
fi
branch_timestamp="$(compose_branch_timestamp)"
branch_descriptor="$(compose_branch_descriptor "$task_slug" "$branch_timestamp")"
branch_name_base="agent/${agent_slug}/${branch_descriptor}"

branch_name="$branch_name_base"
if [[ "$PRINT_NAME_ONLY" -eq 1 ]]; then
  printf '%s\n' "$branch_name"
  exit 0
fi

if [[ "$BASE_BRANCH_EXPLICIT" -eq 0 ]]; then
  current_branch="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  protected_branches_raw="$(resolve_protected_branches "$repo_root")"
  if [[ -n "$current_branch" && "$current_branch" != "HEAD" ]] && is_protected_branch_name "$current_branch" "$protected_branches_raw"; then
    BASE_BRANCH="$current_branch"
  else
    configured_base="$(git -C "$repo_root" config --get multiagent.baseBranch || true)"
    if [[ -n "$configured_base" ]]; then
      BASE_BRANCH="$configured_base"
    elif [[ -n "$current_branch" && "$current_branch" != "HEAD" ]]; then
      BASE_BRANCH="$current_branch"
    else
      BASE_BRANCH="dev"
    fi
  fi
fi

if git show-ref --verify --quiet "refs/remotes/origin/${BASE_BRANCH}"; then
  git fetch origin "${BASE_BRANCH}" --quiet
  start_ref="origin/${BASE_BRANCH}"
else
  if ! git show-ref --verify --quiet "refs/heads/${BASE_BRANCH}"; then
    echo "[agent-branch-start] Base branch not found locally or on origin: ${BASE_BRANCH}" >&2
    exit 1
  fi
  start_ref="${BASE_BRANCH}"
fi

timestamp="$(date +%Y%m%d-%H%M%S)"
branch_suffix=2
while git show-ref --verify --quiet "refs/heads/${branch_name}"; do
  branch_name="${branch_name_base}-${branch_suffix}"
  branch_suffix=$((branch_suffix + 1))
done

worktree_root="${repo_root}/${WORKTREE_ROOT_REL}"
mkdir -p "$worktree_root"
worktree_leaf="$(resolve_worktree_leaf "$branch_name" "$agent_slug")"
worktree_path="${worktree_root}/${worktree_leaf}"
openspec_plan_slug="$(resolve_openspec_plan_slug "$branch_name" "$agent_slug" "$task_slug")"
openspec_change_slug="$(resolve_openspec_change_slug "$branch_name" "$task_slug")"
openspec_capability_slug="$(resolve_openspec_capability_slug "$task_slug")"

if [[ -e "$worktree_path" ]]; then
  echo "[agent-branch-start] Worktree path already exists: ${worktree_path}" >&2
  exit 1
fi

auto_transfer_stash_ref=""
auto_transfer_message=""
auto_transfer_source_branch=""
current_branch="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
protected_branches_raw="$(resolve_protected_branches "$repo_root")"
if [[ -n "$current_branch" && "$current_branch" != "HEAD" ]] && is_protected_branch_name "$current_branch" "$protected_branches_raw"; then
  if has_local_changes "$repo_root"; then
    auto_transfer_message="guardex-auto-transfer-${timestamp}-${agent_slug}-${task_slug}"
    if git -C "$repo_root" stash push --include-untracked --message "$auto_transfer_message" >/dev/null 2>&1; then
      auto_transfer_stash_ref="$(resolve_stash_ref_by_message "$repo_root" "$auto_transfer_message")"
      if [[ -n "$auto_transfer_stash_ref" ]]; then
        auto_transfer_source_branch="$current_branch"
        echo "[agent-branch-start] Detected local changes on protected branch '${current_branch}'. Moving them to '${branch_name}'..."
      fi
    fi
  fi
fi

worktree_add_output=""
if ! worktree_add_output="$(git -C "$repo_root" worktree add -b "$branch_name" "$worktree_path" "$start_ref" 2>&1)"; then
  printf '%s\n' "$worktree_add_output" >&2
  exit 1
fi
git -C "$repo_root" config "branch.${branch_name}.guardexBase" "$BASE_BRANCH" >/dev/null 2>&1 || true
git -C "$repo_root" config "branch.${branch_name}.guardexWorktreeRoot" "$WORKTREE_ROOT_REL" >/dev/null 2>&1 || true
# Fresh agent branches should start unpublished; clear any inherited base-branch tracking.
git -C "$worktree_path" branch --unset-upstream "$branch_name" >/dev/null 2>&1 || true

if [[ -n "$auto_transfer_stash_ref" ]]; then
  if git -C "$worktree_path" stash apply "$auto_transfer_stash_ref" >/dev/null 2>&1; then
    git -C "$repo_root" stash drop "$auto_transfer_stash_ref" >/dev/null 2>&1 || true
    transfer_label="${auto_transfer_source_branch:-$BASE_BRANCH}"
    echo "[agent-branch-start] Moved local changes from '${transfer_label}' into '${branch_name}'."
  else
    echo "[agent-branch-start] Failed to auto-apply moved changes in new worktree." >&2
    transfer_label="${auto_transfer_source_branch:-$BASE_BRANCH}"
    echo "[agent-branch-start] Changes are preserved in ${auto_transfer_stash_ref} on ${transfer_label}." >&2
    echo "[agent-branch-start] Apply manually with: git -C \"$worktree_path\" stash apply \"${auto_transfer_stash_ref}\"" >&2
    exit 1
  fi
fi

hydrate_local_helper_in_worktree "$repo_root" "$worktree_path" "scripts/codex-agent.sh"
hydrate_dependency_dir_symlink_in_worktree "$repo_root" "$worktree_path" "node_modules"
hydrate_dependency_dir_symlink_in_worktree "$repo_root" "$worktree_path" "apps/frontend/node_modules"
hydrate_dependency_dir_symlink_in_worktree "$repo_root" "$worktree_path" "apps/backend/node_modules"
if ! initialize_openspec_change_workspace "$repo_root" "$worktree_path" "$openspec_change_slug" "$openspec_capability_slug"; then
  exit 1
fi
if ! initialize_openspec_plan_workspace "$repo_root" "$worktree_path" "$openspec_plan_slug"; then
  exit 1
fi

echo "[agent-branch-start] Created branch: ${branch_name}"
echo "[agent-branch-start] Worktree: ${worktree_path}"
echo "[agent-branch-start] OpenSpec change: openspec/changes/${openspec_change_slug}"
echo "[agent-branch-start] OpenSpec plan: openspec/plan/${openspec_plan_slug}"
echo "[agent-branch-start] Next steps:"
echo "  cd \"${worktree_path}\""
echo "  python3 scripts/agent-file-locks.py claim --branch \"${branch_name}\" <file...>"
echo "  # implement + commit"
echo "  bash scripts/agent-branch-finish.sh --branch \"${branch_name}\" --base ${BASE_BRANCH} --via-pr --wait-for-merge"
