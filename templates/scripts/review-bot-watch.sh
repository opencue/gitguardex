#!/usr/bin/env bash
set -euo pipefail

INTERVAL_SECONDS="${GUARDEX_REVIEW_BOT_INTERVAL_SECONDS:-30}"
AGENT_NAME="${GUARDEX_REVIEW_BOT_AGENT_NAME:-guardex-review-bot}"
TASK_PREFIX="${GUARDEX_REVIEW_BOT_TASK_PREFIX:-review-merge}"
STATE_FILE="${GUARDEX_REVIEW_BOT_STATE_FILE:-}"
BASE_BRANCH="${GUARDEX_REVIEW_BOT_BASE_BRANCH:-}"
ONLY_PR="${GUARDEX_REVIEW_BOT_ONLY_PR:-}"
RETRY_FAILED_RAW="${GUARDEX_REVIEW_BOT_RETRY_FAILED:-false}"
INCLUDE_DRAFT_RAW="${GUARDEX_REVIEW_BOT_INCLUDE_DRAFT:-false}"
NODE_BIN="${GUARDEX_NODE_BIN:-node}"
CLI_ENTRY="${GUARDEX_CLI_ENTRY:-}"

usage() {
  cat <<'USAGE'
Usage: gx review [options]

Continuously monitor GitHub pull requests targeting a base branch and dispatch
one Codex-agent task per newly opened/updated PR.

Options:
  --base <branch>            Base branch to watch (default: current branch)
  --interval <seconds>       Poll interval (default: 30)
  --agent <name>             Agent name for codex-agent (default: guardex-review-bot)
  --task-prefix <prefix>     Task prefix for codex-agent branches (default: review-merge)
  --state-file <path>        State file path (default: .omx/state/review-bot-watch-<base>.tsv)
  --only-pr <number>         Watch only one PR number
  --include-draft            Include draft PRs
  --retry-failed             Retry PRs that previously failed even when SHA is unchanged
  --once                     Run one poll cycle and exit
  -h, --help                 Show this help

Environment overrides:
  GUARDEX_REVIEW_BOT_PROMPT_APPEND  Additional instructions appended to each Codex prompt
USAGE
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
  echo "[review-bot-watch] Guardex CLI entrypoint unavailable; rerun via gx." >&2
  return 127
}

normalize_bool() {
  local raw="${1:-}"
  local fallback="${2:-0}"
  case "$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) printf '1' ;;
    0|false|no|off) printf '0' ;;
    '') printf '%s' "$fallback" ;;
    *) printf '%s' "$fallback" ;;
  esac
}

gh_api_probe_looks_like_network_failure() {
  local probe_output="$1"
  [[ "$probe_output" =~ error[[:space:]]connecting[[:space:]]to[[:space:]]api\.github\.com|Could[[:space:]]not[[:space:]]resolve[[:space:]]host|could[[:space:]]not[[:space:]]resolve[[:space:]]host|Failed[[:space:]]to[[:space:]]connect|failed[[:space:]]to[[:space:]]connect|Network[[:space:]]is[[:space:]]unreachable|network[[:space:]]is[[:space:]]unreachable|Connection[[:space:]]timed[[:space:]]out|connection[[:space:]]timed[[:space:]]out|Temporary[[:space:]]failure[[:space:]]in[[:space:]]name[[:space:]]resolution|temporary[[:space:]]failure[[:space:]]in[[:space:]]name[[:space:]]resolution ]]
}

ensure_gh_auth_or_explain() {
  local auth_output probe_output
  if auth_output="$(gh auth status 2>&1)"; then
    return 0
  fi

  if probe_output="$(gh api user --jq .login 2>&1)"; then
    echo "[review-bot-watch] gh auth status failed, but gh api user succeeded; continuing with usable GitHub auth." >&2
    return 0
  fi

  if gh_api_probe_looks_like_network_failure "$probe_output"; then
    echo "[review-bot-watch] GitHub API is unreachable, so gh cannot validate the stored token." >&2
    echo "[review-bot-watch] This is a network or Codex sandbox connectivity problem, not proof that the token is invalid." >&2
    echo "$probe_output" >&2
    return 1
  fi

  echo "[review-bot-watch] gh is not authenticated. Run: gh auth login" >&2
  if [[ -n "$auth_output" ]]; then
    echo "$auth_output" >&2
  fi
  return 1
}

ONCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      BASE_BRANCH="${2:-}"
      shift 2
      ;;
    --interval)
      INTERVAL_SECONDS="${2:-}"
      shift 2
      ;;
    --agent)
      AGENT_NAME="${2:-}"
      shift 2
      ;;
    --task-prefix)
      TASK_PREFIX="${2:-}"
      shift 2
      ;;
    --state-file)
      STATE_FILE="${2:-}"
      shift 2
      ;;
    --only-pr)
      ONLY_PR="${2:-}"
      shift 2
      ;;
    --retry-failed)
      RETRY_FAILED_RAW="true"
      shift
      ;;
    --include-draft)
      INCLUDE_DRAFT_RAW="true"
      shift
      ;;
    --once)
      ONCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[review-bot-watch] Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

RETRY_FAILED="$(normalize_bool "$RETRY_FAILED_RAW" "0")"
INCLUDE_DRAFT="$(normalize_bool "$INCLUDE_DRAFT_RAW" "0")"

if [[ ! "$INTERVAL_SECONDS" =~ ^[0-9]+$ ]] || [[ "$INTERVAL_SECONDS" -lt 5 ]]; then
  echo "[review-bot-watch] --interval must be an integer >= 5 seconds." >&2
  exit 1
fi

if [[ -n "$ONLY_PR" ]] && [[ ! "$ONLY_PR" =~ ^[0-9]+$ ]]; then
  echo "[review-bot-watch] --only-pr must be a numeric PR id." >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[review-bot-watch] Not inside a git repository." >&2
  exit 1
fi
repo_root="$(git rev-parse --show-toplevel)"

# Remember whether the caller named a base: with --only-pr and no --base the
# PR itself decides it (resolved below, once gh is available). Defaulting to
# the current branch watched the agent's OWN branch, found "No open PRs" and
# exited 0 without reviewing anything.
BASE_EXPLICIT=0
if [[ -n "$BASE_BRANCH" ]]; then
  BASE_EXPLICIT=1
fi
if [[ -z "$BASE_BRANCH" ]]; then
  BASE_BRANCH="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
fi
if [[ -z "$BASE_BRANCH" || "$BASE_BRANCH" == "HEAD" ]]; then
  BASE_BRANCH="main"
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "[review-bot-watch] Missing GitHub CLI (gh)." >&2
  echo "[review-bot-watch] Install gh and run: gh auth login" >&2
  exit 127
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "[review-bot-watch] Missing Codex CLI command: codex" >&2
  exit 127
fi

if ! ensure_gh_auth_or_explain; then
  exit 1
fi

if [[ -n "$ONLY_PR" && "$BASE_EXPLICIT" -eq 0 ]]; then
  pr_base="$(gh pr view "$ONLY_PR" --json baseRefName,state --jq 'select(.state == "OPEN") | .baseRefName' 2>/dev/null || true)"
  if [[ -z "$pr_base" ]]; then
    echo "[review-bot-watch] PR #${ONLY_PR} is not an open PR in this repository." >&2
    exit 1
  fi
  BASE_BRANCH="$pr_base"
fi

run_codex_agent() {
  local local_script="$repo_root/scripts/codex-agent.sh"
  if [[ -x "$local_script" ]]; then
    bash "$local_script" "$@"
    return $?
  fi
  run_guardex_cli internal run-shell codexAgent --target "$repo_root" "$@"
}

sanitize_slug() {
  local raw="$1"
  local fallback="$2"
  local slug
  slug="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g')"
  if [[ -z "$slug" ]]; then
    slug="$fallback"
  fi
  printf '%s' "$slug"
}

base_slug="$(sanitize_slug "$BASE_BRANCH" "base")"
if [[ -z "$STATE_FILE" ]]; then
  STATE_FILE="$repo_root/.omx/state/review-bot-watch-${base_slug}.tsv"
fi
mkdir -p "$(dirname "$STATE_FILE")"

declare -A LAST_SHA

declare -A LAST_STATUS

load_state() {
  if [[ ! -f "$STATE_FILE" ]]; then
    return 0
  fi
  while IFS=$'\t' read -r pr sha status updated_at; do
    if [[ -z "${pr:-}" ]] || [[ "${pr:0:1}" == "#" ]]; then
      continue
    fi
    LAST_SHA["$pr"]="$sha"
    LAST_STATUS["$pr"]="$status"
  done < "$STATE_FILE"
}

save_state() {
  {
    echo "# pr\thead_sha\tstatus\tupdated_at"
    for pr in "${!LAST_SHA[@]}"; do
      printf '%s\t%s\t%s\t%s\n' "${pr}" "${LAST_SHA[$pr]}" "${LAST_STATUS[$pr]:-unknown}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    done | sort -n
  } > "$STATE_FILE"
}

build_prompt() {
  local pr="$1"
  local head_branch="$2"
  local head_sha="$3"
  local pr_title="$4"
  local pr_url="$5"

  cat <<PROMPT
You are the continuous PR review+merge Codex agent.

Target PR: #${pr}
URL: ${pr_url}
Title: ${pr_title}
Base branch: ${BASE_BRANCH}
Head branch: ${head_branch}
Head SHA: ${head_sha}

Strict task:
1) Review ONLY this PR's changes using gh CLI context (gh pr view ${pr}, gh pr diff ${pr}).
2) If fixes are needed, implement them in your sandbox branch, run verification (at minimum npm test when available), and push your sandbox branch.
3) When the PR is ready and checks are green, merge this PR into ${BASE_BRANCH} with:
   gh pr merge ${pr} --squash --delete-branch
4) If merge is blocked, explain the blocker and exit non-zero.
5) Do not touch unrelated PRs.
PROMPT

  if [[ -n "${GUARDEX_REVIEW_BOT_PROMPT_APPEND:-}" ]]; then
    printf '\n%s\n' "${GUARDEX_REVIEW_BOT_PROMPT_APPEND}"
  fi
}

list_open_prs() {
  gh pr list \
    --state open \
    --base "$BASE_BRANCH" \
    --json number,headRefName,headRefOid,isDraft,title,url \
    --jq '.[] | "\(.number)\t\(.headRefName)\t\(.headRefOid)\t\(.isDraft)\t\(.title | gsub("\\t"; " "))\t\(.url)"'
}

should_process_pr() {
  local pr="$1"
  local sha="$2"

  local prev_sha="${LAST_SHA[$pr]:-}"
  local prev_status="${LAST_STATUS[$pr]:-}"

  if [[ -z "$prev_sha" ]]; then
    return 0
  fi

  if [[ "$prev_sha" != "$sha" ]]; then
    return 0
  fi

  if [[ "$prev_status" == "failed" && "$RETRY_FAILED" == "1" ]]; then
    return 0
  fi

  return 1
}

process_one_pr() {
  local pr="$1"
  local head_branch="$2"
  local sha="$3"
  local title="$4"
  local url="$5"

  local prompt
  prompt="$(build_prompt "$pr" "$head_branch" "$sha" "$title" "$url")"

  local task_name="${TASK_PREFIX}-pr-${pr}"

  echo "[review-bot-watch] Dispatching Codex agent for PR #${pr} (${head_branch})"
  set +e
  run_codex_agent \
    --task "$task_name" \
    --agent "$AGENT_NAME" \
    --base "$BASE_BRANCH" \
    -- exec "$prompt"
  local exit_code="$?"
  set -e

  LAST_SHA["$pr"]="$sha"
  if [[ "$exit_code" -eq 0 ]]; then
    LAST_STATUS["$pr"]="success"
    echo "[review-bot-watch] PR #${pr}: success"
  else
    LAST_STATUS["$pr"]="failed"
    echo "[review-bot-watch] PR #${pr}: failed (exit=${exit_code})" >&2
  fi

  save_state
}

load_state

echo "[review-bot-watch] Starting monitor"
echo "[review-bot-watch] Base branch : ${BASE_BRANCH}"
echo "[review-bot-watch] Interval    : ${INTERVAL_SECONDS}s"
echo "[review-bot-watch] State file  : ${STATE_FILE}"
if [[ -n "$ONLY_PR" ]]; then
  echo "[review-bot-watch] Only PR      : #${ONLY_PR}"
fi

trap 'echo "[review-bot-watch] Stopped."; exit 0' INT TERM

only_pr_warned=0

while true; do
  found=0
  only_pr_seen=0
  only_pr_draft=0
  while IFS=$'\t' read -r pr head_branch sha is_draft title url; do
    if [[ -z "${pr:-}" ]]; then
      continue
    fi

    found=1

    if [[ -n "$ONLY_PR" && "$pr" != "$ONLY_PR" ]]; then
      continue
    fi

    if [[ "$INCLUDE_DRAFT" != "1" && "$is_draft" == "true" ]]; then
      if [[ -n "$ONLY_PR" ]]; then
        only_pr_draft=1
      fi
      continue
    fi
    only_pr_seen=1

    if ! should_process_pr "$pr" "$sha"; then
      continue
    fi

    process_one_pr "$pr" "$head_branch" "$sha" "$title" "$url"
  done < <(list_open_prs || true)

  if [[ "$found" -eq 0 ]]; then
    echo "[review-bot-watch] No open PRs for base '${BASE_BRANCH}'."
  fi

  # A single requested PR that was never seen was not reviewed: say so and,
  # for --once, fail, so a caller gating a merge on this run cannot read
  # silence as a clean review.
  # The watch loop says it once, not on every poll.
  if [[ -n "$ONLY_PR" && "$only_pr_seen" -eq 0 ]]; then
    if [[ "$ONCE" -eq 1 || "$only_pr_warned" -eq 0 ]]; then
      if [[ "$only_pr_draft" -eq 1 ]]; then
        echo "[review-bot-watch] PR #${ONLY_PR} is a draft (pass --include-draft to review it); nothing was reviewed." >&2
      else
        echo "[review-bot-watch] PR #${ONLY_PR} is not an open PR against base '${BASE_BRANCH}'; nothing was reviewed." >&2
      fi
      only_pr_warned=1
    fi
    if [[ "$ONCE" -eq 1 ]]; then
      exit 1
    fi
  fi

  if [[ "$ONCE" -eq 1 ]]; then
    break
  fi

  sleep "$INTERVAL_SECONDS"
done
