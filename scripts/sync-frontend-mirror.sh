#!/usr/bin/env bash
set -euo pipefail

TARGET_REPO="${TARGET_REPO:-}"
TARGET_BRANCH="${TARGET_BRANCH:-main}"
SOURCE_PREFIX="${SOURCE_PREFIX:-frontend}"
SYNC_TOKEN="${SYNC_TOKEN:-${GITHUB_TOKEN:-}}"
TOKEN_FILE=""

usage() {
  cat <<'EOF'
Usage: sync-frontend-mirror.sh [options]

Options:
  --repo <owner/name>     Target GitHub repository (default: $TARGET_REPO)
  --branch <name>         Target branch in the mirror repository (default: main)
  --source-prefix <path>  Subtree path to mirror (default: frontend)
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
  SYNC_TOKEN="${SYNC_TOKEN//$'\n'/}"
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

if ! split_sha="$(git subtree split --prefix="$SOURCE_PREFIX" HEAD 2>/dev/null)"; then
  echo "[frontend-mirror-sync] Failed to compute subtree split for '${SOURCE_PREFIX}'." >&2
  exit 1
fi

# Pass the token via http.extraHeader through git's per-process env config so
# it never appears in argv or in the remote URL (both are visible in `ps`).
remote_url="https://github.com/${TARGET_REPO}.git"
push_output=""
if ! push_output="$(GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="http.extraHeader" \
    GIT_CONFIG_VALUE_0="Authorization: Bearer ${SYNC_TOKEN}" \
    git push --force "$remote_url" "${split_sha}:${TARGET_BRANCH}" 2>&1)"; then
  sanitized_output="$push_output"
  if [[ -n "$SYNC_TOKEN" ]]; then
    sanitized_output="${sanitized_output//${SYNC_TOKEN}/***}"
  fi
  echo "[frontend-mirror-sync] Push failed for ${TARGET_REPO}:${TARGET_BRANCH}." >&2
  echo "$sanitized_output" >&2
  exit 1
fi

echo "[frontend-mirror-sync] Synced ${SOURCE_PREFIX} (commit ${split_sha}) -> ${TARGET_REPO}:${TARGET_BRANCH}"
