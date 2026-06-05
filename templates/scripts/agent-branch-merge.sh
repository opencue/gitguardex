#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH=""
BASE_BRANCH_EXPLICIT=0
TARGET_BRANCH=""
TASK_NAME=""
AGENT_NAME="${GUARDEX_MERGE_AGENT_NAME:-codex}"
NODE_BIN="${GUARDEX_NODE_BIN:-node}"
CLI_ENTRY="${GUARDEX_CLI_ENTRY:-}"
declare -a SOURCE_BRANCHES=()

usage() {
  cat <<'EOF'
Usage: gx branch merge --branch <agent/...> [--branch <agent/...> ...] [--into <agent/...>] [--task <task>] [--agent <agent>] [--base <branch>]

Examples:
  gx branch merge --branch agent/codex/ui-a --branch agent/codex/ui-b
  gx branch merge --into agent/codex/owner-lane --branch agent/codex/helper-a --branch agent/codex/helper-b
EOF
}

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
  echo "[agent-branch-merge] Guardex CLI entrypoint unavailable; rerun via gx." >&2
  return 127
}

sanitize_slug() {
  local raw="$1"
  local fallback="${2:-merge-agent-branches}"
  local slug
  slug="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g')"
  if [[ -z "$slug" ]]; then
    slug="$fallback"
  fi
  printf '%s' "$slug"
}

resolve_base_branch() {
  local repo="$1"
  local explicit_target="$2"
  local configured=""
  local branch_base=""

  if [[ -n "$explicit_target" ]]; then
    branch_base="$(git -C "$repo" config --get "branch.${explicit_target}.guardexBase" || true)"
    if [[ -n "$branch_base" ]]; then
      printf '%s' "$branch_base"
      return 0
    fi
  fi

  configured="$(git -C "$repo" config --get multiagent.baseBranch || true)"
  if [[ -n "$configured" ]]; then
    printf '%s' "$configured"
    return 0
  fi

  for fallback in dev main master; do
    if git -C "$repo" show-ref --verify --quiet "refs/heads/${fallback}" \
      || git -C "$repo" show-ref --verify --quiet "refs/remotes/origin/${fallback}"; then
      printf '%s' "$fallback"
      return 0
    fi
  done

  printf '%s' "dev"
}

get_worktree_for_branch() {
  local repo="$1"
  local branch="$2"
  git -C "$repo" worktree list --porcelain | awk -v target="refs/heads/${branch}" '
    $1 == "worktree" { wt = $2 }
    $1 == "branch" && $2 == target { print wt; exit }
  '
}

is_clean_worktree() {
  local wt="$1"
  git -C "$wt" diff --quiet -- . ":(exclude).omx/state/agent-file-locks.json" \
    && git -C "$wt" diff --cached --quiet -- . ":(exclude).omx/state/agent-file-locks.json" \
    && [[ -z "$(git -C "$wt" ls-files --others --exclude-standard)" ]]
}

has_in_progress_git_op() {
  local wt="$1"
  local git_dir=""
  git_dir="$(git -C "$wt" rev-parse --git-dir 2>/dev/null || true)"
  if [[ -z "$git_dir" ]]; then
    return 1
  fi
  if [[ "$git_dir" != /* ]]; then
    git_dir="$(cd "$wt/$git_dir" 2>/dev/null && pwd -P || true)"
  fi
  if [[ -z "$git_dir" ]]; then
    return 1
  fi
  [[ -f "${git_dir}/MERGE_HEAD" || -d "${git_dir}/rebase-merge" || -d "${git_dir}/rebase-apply" ]]
}

select_unique_worktree_path() {
  local root="$1"
  local name="$2"
  local candidate="${root}/${name}"
  local suffix=2
  while [[ -e "$candidate" ]]; do
    candidate="${root}/${name}-${suffix}"
    suffix=$((suffix + 1))
  done
  printf '%s' "$candidate"
}

branch_exists() {
  local repo="$1"
  local branch="$2"
  git -C "$repo" show-ref --verify --quiet "refs/heads/${branch}"
}

branch_is_agent_lane() {
  local branch="$1"
  [[ "$branch" == agent/* ]]
}

array_contains() {
  local needle="$1"
  shift || true
  local item
  for item in "$@"; do
    if [[ "$item" == "$needle" ]]; then
      return 0
    fi
  done
  return 1
}

collect_branch_files() {
  local repo="$1"
  local base_ref="$2"
  local branch="$3"
  git -C "$repo" diff --name-only "${base_ref}...${branch}" -- . ":(exclude).omx/state/agent-file-locks.json" 2>/dev/null || true
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      BASE_BRANCH="${2:-}"
      BASE_BRANCH_EXPLICIT=1
      shift 2
      ;;
    --into)
      TARGET_BRANCH="${2:-}"
      shift 2
      ;;
    --branch)
      SOURCE_BRANCHES+=("${2:-}")
      shift 2
      ;;
    --task)
      TASK_NAME="${2:-}"
      shift 2
      ;;
    --agent)
      AGENT_NAME="${2:-codex}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[agent-branch-merge] Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[agent-branch-merge] Not inside a git repository." >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
common_git_dir_raw="$(git -C "$repo_root" rev-parse --git-common-dir)"
if [[ "$common_git_dir_raw" == /* ]]; then
  common_git_dir="$common_git_dir_raw"
else
  common_git_dir="$(cd "$repo_root/$common_git_dir_raw" && pwd -P)"
fi
repo_common_root="$(cd "$common_git_dir/.." && pwd -P)"
agent_worktree_root="${repo_common_root}/.omx/agent-worktrees"
mkdir -p "$agent_worktree_root"

if [[ "$BASE_BRANCH_EXPLICIT" -eq 1 && -z "$BASE_BRANCH" ]]; then
  echo "[agent-branch-merge] --base requires a branch value." >&2
  exit 1
fi

if [[ -z "$TARGET_BRANCH" && "${#SOURCE_BRANCHES[@]}" -lt 1 ]]; then
  echo "[agent-branch-merge] Provide at least one --branch <agent/...> source lane." >&2
  exit 1
fi

if [[ -n "$TARGET_BRANCH" ]] && ! branch_is_agent_lane "$TARGET_BRANCH"; then
  echo "[agent-branch-merge] --into must reference an agent/* branch: ${TARGET_BRANCH}" >&2
  exit 1
fi

deduped_sources=()
for branch in "${SOURCE_BRANCHES[@]}"; do
  if [[ -z "$branch" ]]; then
    echo "[agent-branch-merge] --branch requires an agent/* branch value." >&2
    exit 1
  fi
  if ! branch_is_agent_lane "$branch"; then
    echo "[agent-branch-merge] Source branch must be agent/*: ${branch}" >&2
    exit 1
  fi
  if ! branch_exists "$repo_root" "$branch"; then
    echo "[agent-branch-merge] Local source branch not found: ${branch}" >&2
    exit 1
  fi
  if ! array_contains "$branch" "${deduped_sources[@]}"; then
    deduped_sources+=("$branch")
  fi
done
SOURCE_BRANCHES=("${deduped_sources[@]}")

if [[ "${#SOURCE_BRANCHES[@]}" -eq 0 ]]; then
  echo "[agent-branch-merge] No unique source branches were provided." >&2
  exit 1
fi

if [[ "$BASE_BRANCH_EXPLICIT" -eq 0 ]]; then
  BASE_BRANCH="$(resolve_base_branch "$repo_root" "$TARGET_BRANCH")"
fi

if [[ -z "$BASE_BRANCH" ]]; then
  echo "[agent-branch-merge] Unable to resolve a base branch." >&2
  exit 1
fi

start_ref="$BASE_BRANCH"
if git -C "$repo_root" show-ref --verify --quiet "refs/remotes/origin/${BASE_BRANCH}"; then
  git -C "$repo_root" fetch origin "$BASE_BRANCH" --quiet
  start_ref="origin/${BASE_BRANCH}"
elif ! git -C "$repo_root" show-ref --verify --quiet "refs/heads/${BASE_BRANCH}"; then
  echo "[agent-branch-merge] Base branch not found locally or on origin: ${BASE_BRANCH}" >&2
  exit 1
fi

target_worktree=""
target_created=0

if [[ -z "$TARGET_BRANCH" ]]; then
  if [[ -z "$TASK_NAME" ]]; then
    first_hint="$(printf '%s' "${SOURCE_BRANCHES[0]}" | sed -E 's#^agent/[^/]+/##; s#^agent/##')"
    source_count="${#SOURCE_BRANCHES[@]}"
    if [[ "$source_count" -gt 1 ]]; then
      TASK_NAME="$(sanitize_slug "merge-${first_hint}-and-$((source_count - 1))-more" "merge-agent-branches")"
    else
      TASK_NAME="$(sanitize_slug "merge-${first_hint}" "merge-agent-branches")"
    fi
  else
    TASK_NAME="$(sanitize_slug "$TASK_NAME" "merge-agent-branches")"
  fi

  start_output=""
  if ! start_output="$(
    cd "$repo_root"
    # An integration lane is inherently cross-cutting, so pin it to T3 (full
    # change + plan workspace) regardless of the branch-start default (now T1).
    GUARDEX_OPENSPEC_AUTO_INIT=1 GUARDEX_OPENSPEC_TIER="${GUARDEX_OPENSPEC_TIER:-T3}" \
      run_guardex_cli branch start "$TASK_NAME" "$AGENT_NAME" "$BASE_BRANCH" 2>&1
  )"; then
    printf '%s\n' "$start_output" >&2
    exit 1
  fi

  printf '%s\n' "$start_output"
  TARGET_BRANCH="$(printf '%s\n' "$start_output" | sed -n -E 's/^\[agent-branch-start\] (Created branch|Reusing existing branch): //p' | head -n 1)"
  target_worktree="$(printf '%s\n' "$start_output" | sed -n 's/^\[agent-branch-start\] Worktree: //p' | head -n 1)"
  if [[ -z "$TARGET_BRANCH" || -z "$target_worktree" ]]; then
    echo "[agent-branch-merge] Unable to parse target branch/worktree from agent-branch-start output." >&2
    exit 1
  fi
  target_created=1
else
  if ! branch_exists "$repo_root" "$TARGET_BRANCH"; then
    echo "[agent-branch-merge] Target branch not found: ${TARGET_BRANCH}" >&2
    exit 1
  fi

  target_worktree="$(get_worktree_for_branch "$repo_root" "$TARGET_BRANCH")"
  if [[ -z "$target_worktree" ]]; then
    target_worktree="$(select_unique_worktree_path "$agent_worktree_root" "${TARGET_BRANCH//\//__}")"
    git -C "$repo_root" worktree add "$target_worktree" "$TARGET_BRANCH" >/dev/null
    target_created=1
    echo "[agent-branch-merge] Attached worktree for target branch '${TARGET_BRANCH}': ${target_worktree}"
  fi
fi

if [[ "$TARGET_BRANCH" == "$BASE_BRANCH" ]]; then
  echo "[agent-branch-merge] Target branch must not equal the protected base branch '${BASE_BRANCH}'." >&2
  exit 1
fi

if ! is_clean_worktree "$target_worktree"; then
  if [[ "$target_created" -eq 1 ]]; then
    echo "[agent-branch-merge] Target worktree has freshly generated scaffold changes; continuing inside the new integration lane."
  else
    echo "[agent-branch-merge] Target worktree is not clean: ${target_worktree}" >&2
    echo "[agent-branch-merge] Commit, stash, or discard local changes before merging agent lanes." >&2
    exit 1
  fi
fi

if has_in_progress_git_op "$target_worktree"; then
  echo "[agent-branch-merge] Target worktree has an in-progress merge/rebase: ${target_worktree}" >&2
  echo "[agent-branch-merge] Resolve or abort that git operation before running the merge workflow." >&2
  exit 1
fi

for source_branch in "${SOURCE_BRANCHES[@]}"; do
  if [[ "$source_branch" == "$TARGET_BRANCH" ]]; then
    echo "[agent-branch-merge] Source branch list includes the target branch: ${source_branch}" >&2
    exit 1
  fi
  source_worktree="$(get_worktree_for_branch "$repo_root" "$source_branch")"
  if [[ -n "$source_worktree" ]] && ! is_clean_worktree "$source_worktree"; then
    echo "[agent-branch-merge] Source worktree is not clean for '${source_branch}': ${source_worktree}" >&2
    echo "[agent-branch-merge] Commit or stash source-lane changes before integration." >&2
    exit 1
  fi
done

pending_branches=()
for source_branch in "${SOURCE_BRANCHES[@]}"; do
  if git -C "$repo_root" merge-base --is-ancestor "$source_branch" "$TARGET_BRANCH" >/dev/null 2>&1; then
    echo "[agent-branch-merge] Skipping '${source_branch}' because it is already integrated into '${TARGET_BRANCH}'."
    continue
  fi
  pending_branches+=("$source_branch")
done

if [[ "${#pending_branches[@]}" -eq 0 ]]; then
  echo "[agent-branch-merge] No pending source branches remain for target '${TARGET_BRANCH}'."
  echo "[agent-branch-merge] Target worktree: ${target_worktree}"
  exit 0
fi

declare -A file_to_branches=()
declare -a overlap_files=()
for source_branch in "${pending_branches[@]}"; do
  while IFS= read -r changed_file; do
    [[ -z "$changed_file" ]] && continue
    existing="${file_to_branches[$changed_file]:-}"
    if [[ -z "$existing" ]]; then
      file_to_branches["$changed_file"]="$source_branch"
      continue
    fi
    if [[ ",${existing}," == *",${source_branch},"* ]]; then
      continue
    fi
    file_to_branches["$changed_file"]="${existing},${source_branch}"
    if ! array_contains "$changed_file" "${overlap_files[@]}"; then
      overlap_files+=("$changed_file")
    fi
  done < <(collect_branch_files "$repo_root" "$start_ref" "$source_branch")
done

echo "[agent-branch-merge] Target branch: ${TARGET_BRANCH}"
echo "[agent-branch-merge] Target worktree: ${target_worktree}"
echo "[agent-branch-merge] Base branch: ${BASE_BRANCH} (${start_ref})"
echo "[agent-branch-merge] Merge order: ${pending_branches[*]}"

if [[ "${#overlap_files[@]}" -gt 0 ]]; then
  echo "[agent-branch-merge] Overlapping changed files detected across requested branches:"
  for overlap_file in "${overlap_files[@]}"; do
    branches_csv="${file_to_branches[$overlap_file]}"
    branches_display="$(printf '%s' "$branches_csv" | sed 's/,/, /g')"
    echo "  - ${overlap_file} <- ${branches_display}"
  done
else
  echo "[agent-branch-merge] No overlapping changed files detected across requested branches."
fi

for index in "${!pending_branches[@]}"; do
  source_branch="${pending_branches[$index]}"
  echo "[agent-branch-merge] Merging '${source_branch}' into '${TARGET_BRANCH}'..."
  if git -C "$target_worktree" merge --no-ff --no-edit "$source_branch"; then
    echo "[agent-branch-merge] Merged '${source_branch}'."
    continue
  fi

  conflict_files="$(git -C "$target_worktree" diff --name-only --diff-filter=U || true)"
  echo "[agent-branch-merge] Merge conflict detected while merging '${source_branch}' into '${TARGET_BRANCH}'." >&2
  echo "[agent-branch-merge] Target worktree: ${target_worktree}" >&2
  if [[ -n "$conflict_files" ]]; then
    echo "[agent-branch-merge] Conflicting files:" >&2
    while IFS= read -r conflict_file; do
      [[ -n "$conflict_file" ]] && echo "  - ${conflict_file}" >&2
    done <<< "$conflict_files"
  fi
  echo "[agent-branch-merge] Resolve or abort inside the integration worktree:" >&2
  echo "  cd \"${target_worktree}\"" >&2
  echo "  git status" >&2
  echo "  git add <resolved-files> && git commit" >&2
  echo "  # or: git merge --abort" >&2

  remaining_branches=("${pending_branches[@]:$((index + 1))}")
  if [[ "${#remaining_branches[@]}" -gt 0 ]]; then
    echo "[agent-branch-merge] Remaining branches:" >&2
    for remaining in "${remaining_branches[@]}"; do
      echo "  - ${remaining}" >&2
    done
    resume_cmd="gx merge --into ${TARGET_BRANCH} --base ${BASE_BRANCH}"
    for remaining in "${remaining_branches[@]}"; do
      resume_cmd="${resume_cmd} --branch ${remaining}"
    done
    echo "[agent-branch-merge] Resume after resolving with: ${resume_cmd}" >&2
  fi
  exit 1
done

echo "[agent-branch-merge] Merge sequence complete for '${TARGET_BRANCH}'."
if [[ "$target_created" -eq 1 ]]; then
  echo "[agent-branch-merge] Review and verify in '${target_worktree}', then finish the integration branch when ready."
fi
echo "[agent-branch-merge] Next step: gx branch finish --branch \"${TARGET_BRANCH}\" --base \"${BASE_BRANCH}\" --via-pr --wait-for-merge --cleanup"
