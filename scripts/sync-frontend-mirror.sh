#!/usr/bin/env bash
set -euo pipefail

TARGET_REPO="${TARGET_REPO:-}"
TARGET_BRANCH="${TARGET_BRANCH:-main}"
SOURCE_PREFIX="${SOURCE_PREFIX:-package/frontend}"
SYNC_TOKEN="${SYNC_TOKEN:-${GITHUB_TOKEN:-}}"
TOKEN_FILE=""

usage() {
  cat <<'EOF'
Usage: sync-frontend-mirror.sh [options]

The source tree must still match the frontend on origin/main.

Options:
  --repo <owner/name>     Target GitHub repository (default: $TARGET_REPO)
  --branch <name>         Target branch in the mirror repository (default: main)
  --source-prefix <path>  Directory to mirror (default: package/frontend)
  --token <token>         GitHub token (deprecated: visible in process argv; prefer
                          SYNC_TOKEN/GITHUB_TOKEN env var or --token-file)
  --token-file <path>     Read the GitHub token from a file (avoids argv exposure)
  -h, --help              Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      TARGET_REPO="${2:-}"
      shift 2
      ;;
    --branch)
      TARGET_BRANCH="${2:-}"
      shift 2
      ;;
    --source-prefix)
      SOURCE_PREFIX="${2:-}"
      shift 2
      ;;
    --token)
      SYNC_TOKEN="${2:-}"
      echo "[frontend-mirror-sync] Warning: --token exposes the credential in process argv. Prefer SYNC_TOKEN/GITHUB_TOKEN env var or --token-file." >&2
      shift 2
      ;;
    --token-file)
      TOKEN_FILE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[frontend-mirror-sync] Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -n "$TOKEN_FILE" ]]; then
  if [[ ! -f "$TOKEN_FILE" ]]; then
    echo "[frontend-mirror-sync] Token file not found: ${TOKEN_FILE}" >&2
    exit 1
  fi
  SYNC_TOKEN="$(< "$TOKEN_FILE")"
  SYNC_TOKEN="${SYNC_TOKEN//[$'\r\n']/}"
fi

if [[ -z "$TARGET_REPO" ]]; then
  echo "[frontend-mirror-sync] Missing target repository. Set --repo or TARGET_REPO." >&2
  exit 1
fi

if [[ -z "$SYNC_TOKEN" ]]; then
  echo "[frontend-mirror-sync] Missing token. Set --token, --token-file, SYNC_TOKEN, or GITHUB_TOKEN." >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[frontend-mirror-sync] Not inside a git repository." >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ ! -d "$SOURCE_PREFIX" ]]; then
  echo "[frontend-mirror-sync] Source prefix not found: ${SOURCE_PREFIX}" >&2
  exit 1
fi

if ! source_tree="$(git rev-parse --verify "HEAD:$SOURCE_PREFIX" 2>/dev/null)" ||
  [[ "$(git cat-file -t "$source_tree")" != tree ]]; then
  echo "[frontend-mirror-sync] Source is not a committed directory: ${SOURCE_PREFIX}." >&2
  exit 1
fi

# Pass the token via http.extraHeader through git's per-process env config so
# it never appears in argv or in the remote URL (both are visible in `ps`).
# actions/checkout persists its own http.https://github.com/.extraheader, and
# git sends every value of that multi-valued key; an empty value first resets
# the list so only the mirror token is sent.
remote_url="https://github.com/${TARGET_REPO}.git"
target_ref="refs/heads/${TARGET_BRANCH}"
git check-ref-format "$target_ref"
mirror_git() {
  GIT_CONFIG_COUNT=2 \
    GIT_CONFIG_KEY_0="http.https://github.com/.extraheader" \
    GIT_CONFIG_VALUE_0="" \
    GIT_CONFIG_KEY_1="http.https://github.com/.extraheader" \
    GIT_CONFIG_VALUE_1="AUTHORIZATION: basic $(printf 'x-access-token:%s' "${SYNC_TOKEN}" | base64 | tr -d '\r\n')" \
    git "$@"
}

report_remote_failure() {
  echo "[frontend-mirror-sync] $1 failed for ${TARGET_REPO}:${TARGET_BRANCH}." >&2
  echo "${2//"$SYNC_TOKEN"/***}" >&2
  exit 1
}

# A subtree split from a renamed path starts a new history. Instead, commit the
# exact source tree on the current mirror tip and only allow fast-forward pushes.
parents=()
if output="$(mirror_git ls-remote --exit-code --refs "$remote_url" "$target_ref" 2>&1)"; then
  output="$(mirror_git fetch --no-tags "$remote_url" "$target_ref" 2>&1)" ||
    report_remote_failure Fetch "$output"
  mirror_head="$(git rev-parse --verify FETCH_HEAD)"
  if [[ "$(git rev-parse "$mirror_head^{tree}")" == "$source_tree" ]]; then
    echo "[frontend-mirror-sync] ${TARGET_REPO}:${TARGET_BRANCH} is already up to date."
    exit 0
  fi
  parents=(-p "$mirror_head")
elif [[ $? -ne 2 ]]; then
  report_remote_failure Lookup "$output"
fi

# Check source freshness AFTER reading the mirror's parent. If a newer job
# pushed first, its frontend is already on main. If it pushes after this check,
# the normal fast-forward requirement rejects our competing mirror commit.
# Compare trees, not revisions, so unrelated main changes do not skip a deploy.
if ! git fetch --no-tags origin refs/heads/main ||
  ! current_source_tree="$(git rev-parse --verify "FETCH_HEAD:$SOURCE_PREFIX" 2>/dev/null)"; then
  echo "[frontend-mirror-sync] Cannot verify ${SOURCE_PREFIX} on origin/main; not publishing." >&2
  exit 1
fi
if [[ "$current_source_tree" != "$source_tree" ]]; then
  echo "[frontend-mirror-sync] Stale source checkout; not publishing an older frontend tree."
  exit 0
fi

source_rev="$(git rev-parse HEAD)"
# The conditional array expansion also works in macOS's Bash 3.2 with nounset.
snapshot="$(git -c user.name='GitGuardex frontend mirror' \
  -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  commit-tree "$source_tree" ${parents[@]+"${parents[@]}"} -m "Sync frontend from ${source_rev}")"
output="$(mirror_git push "$remote_url" "${snapshot}:${target_ref}" 2>&1)" ||
  report_remote_failure Push "$output"

echo "[frontend-mirror-sync] Synced ${SOURCE_PREFIX} (commit ${snapshot}) -> ${TARGET_REPO}:${TARGET_BRANCH}"
