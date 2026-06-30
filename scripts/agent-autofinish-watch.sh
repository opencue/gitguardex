#!/usr/bin/env bash
# Detect stalled agent/* worktrees and (optionally) reap lanes whose PR already
# merged but whose worktree was retained on disk.
#
# This is the watcher that scripts/agent-stalled-report.sh (the SessionStart
# hook) expects. Without it, that shim soft-exits 0 and merged-PR worktrees are
# never cleaned up (the "retained for now" path in agent-branch-finish.sh).
#
# It does NOT reinvent cleanup: reaping delegates to `gx worktree prune`
# (scripts/agent-worktree-prune.sh), the existing, tested primitive.
#
# Per-lane status lines use the prefix the report shim greps:
#   [agent-autofinish-watch] agent/<branch>: <status>
# A line is emitted ONLY for actionable lanes (merged-but-retained, or stalled
# with no open PR after the idle gate). Healthy in-flight lanes stay silent.
#
# Exit codes: 0 always (informational); reaping failures warn but do not fail.

set -euo pipefail

MODE="once"            # once | daemon
DRY_RUN=0
AUTO_MERGE=0
INTERVAL=300
IDLE_MINUTES="${GUARDEX_AUTOFINISH_IDLE_MINUTES:-60}"
BASE_BRANCH="${GUARDEX_BASE_BRANCH:-}"
GH_BIN="${GUARDEX_GH_BIN:-gh}"
NOW_EPOCH_OVERRIDE="${GUARDEX_AUTOFINISH_NOW_EPOCH:-}"

WORKTREE_ROOT_RELS=(
  ".omx/agent-worktrees"
  ".omx/.tmp-worktrees"
  ".omc/agent-worktrees"
  ".omc/.tmp-worktrees"
)
LOCK_FILE_REL=".omx/state/agent-file-locks.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --once) MODE="once"; shift ;;
    --daemon) MODE="daemon"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --auto-merge) AUTO_MERGE=1; shift ;;
    --interval) INTERVAL="${2:-300}"; shift 2 ;;
    --idle-minutes) IDLE_MINUTES="${2:-60}"; shift 2 ;;
    --base) BASE_BRANCH="${2:-}"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--once|--daemon] [--dry-run] [--auto-merge] [--interval SEC] [--idle-minutes MIN] [--base BRANCH]"
      exit 0
      ;;
    *)
      echo "[agent-autofinish-watch] Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[agent-autofinish-watch] Not inside a git repository." >&2
  exit 0
fi

# Resolve the PRIMARY checkout root, not the current worktree: the managed
# worktree roots (.omc/agent-worktrees, ...) live under the primary checkout,
# and refs/reflogs are shared via the common git dir. Running from inside an
# agent worktree must still see every sibling lane.
git_common_dir="$(git rev-parse --git-common-dir 2>/dev/null)"
case "$git_common_dir" in
  /*) ;;
  *) git_common_dir="$(git rev-parse --show-toplevel)/${git_common_dir}" ;;
esac
repo_root="$(cd "$(dirname "$git_common_dir")" && pwd)"

resolve_base_branch() {
  [[ -n "$BASE_BRANCH" ]] && return 0
  local head_ref
  head_ref="$(git -C "$repo_root" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  if [[ -n "$head_ref" ]]; then
    BASE_BRANCH="${head_ref#origin/}"
    return 0
  fi
  for cand in main master dev; do
    if git -C "$repo_root" show-ref --verify --quiet "refs/heads/${cand}"; then
      BASE_BRANCH="$cand"
      return 0
    fi
  done
  BASE_BRANCH="main"
}

is_managed_worktree_path() {
  local entry="$1" rel
  for rel in "${WORKTREE_ROOT_RELS[@]}"; do
    [[ "$entry" == "${repo_root}/${rel}"/* ]] && return 0
  done
  return 1
}

is_temporary_worktree_path() {
  local name
  name="$(basename "$1")"
  [[ "$name" == __agent_integrate-* || "$name" == __source-probe-* ]]
}

now_epoch() {
  if [[ -n "$NOW_EPOCH_OVERRIDE" ]]; then
    printf '%s' "$NOW_EPOCH_OVERRIDE"
  else
    date +%s
  fi
}

has_live_process_in_worktree() {
  local wt="$1" proc_cwd live_cwd
  [[ -d /proc ]] || return 1
  for proc_cwd in /proc/[0-9]*/cwd; do
    [[ -e "$proc_cwd" ]] || continue
    live_cwd="$(readlink "$proc_cwd" 2>/dev/null || true)"
    [[ -n "$live_cwd" ]] || continue
    live_cwd="${live_cwd% (deleted)}"
    if [[ "$live_cwd" == "$wt" || "$live_cwd" == "${wt}"/* ]]; then
      return 0
    fi
  done
  return 1
}

branch_idle_minutes() {
  local branch="$1" wt="$2" activity_epoch="" lock_mtime now
  activity_epoch="$(git -C "$repo_root" reflog show --format='%ct' -n 1 "refs/heads/${branch}" 2>/dev/null | head -n1 | tr -d '[:space:]')"
  if [[ -z "$activity_epoch" ]]; then
    activity_epoch="$(git -C "$repo_root" log -1 --format='%ct' "$branch" 2>/dev/null | head -n1 | tr -d '[:space:]')"
  fi
  if [[ -n "$wt" && -f "${wt}/${LOCK_FILE_REL}" ]]; then
    lock_mtime="$(stat -c %Y "${wt}/${LOCK_FILE_REL}" 2>/dev/null || stat -f %m "${wt}/${LOCK_FILE_REL}" 2>/dev/null || true)"
    if [[ "$lock_mtime" =~ ^[0-9]+$ && ( -z "$activity_epoch" || "$lock_mtime" -gt "$activity_epoch" ) ]]; then
      activity_epoch="$lock_mtime"
    fi
  fi
  [[ "$activity_epoch" =~ ^[0-9]+$ ]] || { printf '%s' 999999; return; }
  now="$(now_epoch)"
  printf '%s' $(( (now - activity_epoch) / 60 ))
}

# Count uncommitted changes, ignoring lock-file churn.
dirty_count() {
  local wt="$1"
  git -C "$wt" status --porcelain -- . ":(exclude)${LOCK_FILE_REL}" 2>/dev/null | grep -c . || true
}

commits_ahead() {
  local branch="$1"
  git -C "$repo_root" rev-list --count "${BASE_BRANCH}..${branch}" 2>/dev/null || printf '0'
}

# Prefer the gx CLI; fall back to the bundled prune script.
run_prune() {
  if command -v gx >/dev/null 2>&1; then
    gx worktree prune "$@"
  else
    bash "${repo_root}/scripts/agent-worktree-prune.sh" "$@"
  fi
}

declare -A MERGED_BRANCHES=()
declare -A OPEN_BRANCHES=()

load_pr_state() {
  command -v "$GH_BIN" >/dev/null 2>&1 || return 0
  local line
  while IFS= read -r line; do
    [[ -n "$line" ]] && MERGED_BRANCHES["$line"]=1
  done < <("$GH_BIN" pr list --state merged --base "$BASE_BRANCH" --limit 200 --json headRefName --jq '.[].headRefName' 2>/dev/null || true)
  while IFS= read -r line; do
    [[ -n "$line" ]] && OPEN_BRANCHES["$line"]=1
  done < <("$GH_BIN" pr list --state open --base "$BASE_BRANCH" --limit 200 --json headRefName --jq '.[].headRefName' 2>/dev/null || true)
}

run_once() {
  resolve_base_branch
  MERGED_BRANCHES=()
  OPEN_BRANCHES=()
  load_pr_state

  local scanned=0 stalled=0 merged=0
  local cur_wt="" cur_branch=""

  while IFS= read -r line; do
    if [[ "$line" == worktree\ * ]]; then
      cur_wt="${line#worktree }"
      cur_branch=""
    elif [[ "$line" == branch\ refs/heads/* ]]; then
      cur_branch="${line#branch refs/heads/}"
    elif [[ -z "$line" ]]; then
      process_lane "$cur_wt" "$cur_branch"
      cur_wt=""; cur_branch=""
    fi
  done < <(git -C "$repo_root" worktree list --porcelain; printf '\n')

  # Reap merged-but-retained lanes before the summary so reaped= is accurate.
  if [[ "$merged" -gt 0 ]]; then
    reap_merged
  fi

  printf '[agent-autofinish-watch] scanned=%s stalled=%s merged=%s reaped=%s\n' \
    "$scanned" "$stalled" "$merged" "$reaped"
}

# process_lane mutates scanned/stalled/merged/reaped/merged_lanes in the caller
# scope (bash dynamic scope via run_once locals).
process_lane() {
  local wt="$1" branch="$2"
  [[ -n "$wt" && -n "$branch" ]] || return 0
  [[ "$branch" == agent/* ]] || return 0
  is_managed_worktree_path "$wt" || return 0
  is_temporary_worktree_path "$wt" && return 0
  scanned=$((scanned + 1))

  if [[ -n "${MERGED_BRANCHES[$branch]:-}" && -d "$wt" ]]; then
    merged=$((merged + 1))
    echo "[agent-autofinish-watch] ${branch}: merged PR, worktree retained -> prunable"
    return 0
  fi

  # Open PR or live process => healthy in-flight, stay silent.
  [[ -n "${OPEN_BRANCHES[$branch]:-}" ]] && return 0
  has_live_process_in_worktree "$wt" && return 0

  local idle dirty ahead
  idle="$(branch_idle_minutes "$branch" "$wt")"
  [[ "$idle" -ge "$IDLE_MINUTES" ]] || return 0

  dirty="$(dirty_count "$wt")"
  if [[ "$dirty" -gt 0 ]]; then
    stalled=$((stalled + 1))
    echo "[agent-autofinish-watch] ${branch}: ${dirty} uncommitted change(s), idle ${idle}m -> needs commit + finish"
    return 0
  fi

  ahead="$(commits_ahead "$branch")"
  if [[ "$ahead" -gt 0 ]]; then
    stalled=$((stalled + 1))
    echo "[agent-autofinish-watch] ${branch}: ${ahead} commit(s) ahead of ${BASE_BRANCH}, no PR, idle ${idle}m -> needs finish"
  fi
}

reaped=0

reap_merged() {
  [[ "$AUTO_MERGE" -eq 1 ]] || return 0
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[agent-autofinish-watch] [dry-run] would prune merged lanes: gx worktree prune --include-pr-merged --delete-branches --base ${BASE_BRANCH}"
    return 0
  fi
  local out=""
  out="$(run_prune --include-pr-merged --delete-branches --base "$BASE_BRANCH" 2>&1 || true)"
  printf '%s\n' "$out"
  local removed
  removed="$(printf '%s\n' "$out" | sed -n 's/.*removed_worktrees=\([0-9]*\).*/\1/p' | head -n1)"
  [[ "$removed" =~ ^[0-9]+$ ]] && reaped="$removed"
}

if [[ "$MODE" == "daemon" ]]; then
  while true; do
    reaped=0
    run_once
    sleep "$INTERVAL"
  done
else
  reaped=0
  run_once
fi
