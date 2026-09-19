#!/usr/bin/env bash
# npm audit, retried on registry trouble only.
#
# On 2026-09-19 the npm advisory endpoints returned HTTP 400 for about twenty
# minutes ("audit endpoint returned an error"), which turned every PR's
# "Audit dependencies" step red and blocked the review gate. That is a
# registry outage, not a finding. This wrapper retries such errors with a
# short backoff and fails immediately on anything else, so a real HIGH or
# CRITICAL vulnerability is still reported on the first attempt.
#
# Usage: scripts/npm-audit-retry.sh [npm audit args...]
#   NPM_AUDIT_ATTEMPTS  attempts before giving up (default 4)
#   NPM_AUDIT_BACKOFF   seconds before the first retry, doubling (default 15)

set -uo pipefail

attempts="${NPM_AUDIT_ATTEMPTS:-4}"
backoff="${NPM_AUDIT_BACKOFF:-15}"

is_registry_error() {
  grep -qiE \
    'audit endpoint returned an error|ENOAUDIT|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|50[0-9] (Internal|Bad Gateway|Service Unavailable|Gateway Timeout)' \
    "$1"
}

output="$(mktemp)"
trap 'rm -f "$output"' EXIT

for ((attempt = 1; attempt <= attempts; attempt += 1)); do
  if npm audit "$@" 2>&1 | tee "$output"; then
    exit 0
  fi
  if ! is_registry_error "$output"; then
    # Vulnerabilities, a bad lockfile, bad arguments: not worth retrying.
    exit 1
  fi
  if ((attempt == attempts)); then
    echo "[npm-audit-retry] registry error persisted after ${attempts} attempt(s); giving up." >&2
    exit 1
  fi
  echo "[npm-audit-retry] registry error on attempt ${attempt}/${attempts}; retrying in ${backoff}s." >&2
  sleep "$backoff"
  backoff=$((backoff * 2))
done
