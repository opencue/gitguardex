#!/usr/bin/env bash
# Pre-flight verification gate for gitguardex-managed projects.
#
# Runs in the agent's worktree from `gx branch finish` BEFORE the push
# happens. Returns non-zero to refuse the push so a broken commit
# never reaches the PR / CI / merge funnel.
#
# Auto-detects the project's stack and runs conventional verification:
#   - Node/pnpm:   pnpm typecheck && pnpm lint && pnpm test (each only
#                  if the script exists in package.json)
#   - Node/npm:    npm test (only if defined)
#   - Rust:        cargo check
#   - Python:      ruff check (only if ruff is installed)
#
# Override per-project by replacing this file (delete the symlink under
# scripts/agent-preflight.sh and write your own).
#
# Skip a single run with `gx branch finish --no-preflight`.

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root"

ran=0        # steps that PASSED
attempted=0  # steps that RAN (pass or fail) — drives stack detection
fail=0
# Quiet by default: a green `npm test` run can be hundreds of lines of TAP that
# floods the agent's context on every `gx branch finish`. Capture each step's
# output, print a one-line summary on success, and surface only the tail on
# failure (where it is actually useful). Stream full output live with
# GUARDEX_PREFLIGHT_VERBOSE=1.
GUARDEX_PREFLIGHT_FAIL_TAIL="${GUARDEX_PREFLIGHT_FAIL_TAIL:-40}"
run_step() {
  local label="$1"
  shift
  echo "[agent-preflight] -> $label"
  attempted=$((attempted + 1))
  if [[ "${GUARDEX_PREFLIGHT_VERBOSE:-0}" == "1" ]]; then
    if "$@"; then
      ran=$((ran + 1))
      echo "[agent-preflight]    ok"
    else
      echo "[agent-preflight] FAIL: $label" >&2
      fail=1
    fi
    return 0
  fi
  local out rc
  # `if` keeps `set -e` from aborting on a failing step before we capture rc.
  if out="$("$@" 2>&1)"; then
    rc=0
  else
    rc=$?
  fi
  if [[ "$rc" -eq 0 ]]; then
    ran=$((ran + 1))
    echo "[agent-preflight]    ok ($(printf '%s\n' "$out" | wc -l | tr -d ' ') lines suppressed; GUARDEX_PREFLIGHT_VERBOSE=1 to show)"
  else
    echo "[agent-preflight] FAIL: $label (exit $rc) — last ${GUARDEX_PREFLIGHT_FAIL_TAIL} lines:" >&2
    printf '%s\n' "$out" | tail -n "$GUARDEX_PREFLIGHT_FAIL_TAIL" >&2
    fail=1
  fi
}

has_package_script() {
  local script_name="$1"
  [[ -f package.json ]] || return 1
  grep -E "\"${script_name}\"\\s*:" package.json >/dev/null 2>&1
}

# Node detection
if [[ -f package.json ]]; then
  pkg_manager=""
  if command -v pnpm >/dev/null 2>&1 && [[ -f pnpm-lock.yaml ]]; then
    pkg_manager="pnpm"
  elif command -v npm >/dev/null 2>&1 && [[ -f package-lock.json ]]; then
    pkg_manager="npm"
  fi

  case "$pkg_manager" in
    pnpm)
      has_package_script typecheck && run_step "pnpm typecheck" pnpm typecheck
      has_package_script lint && run_step "pnpm lint" pnpm lint
      has_package_script test && run_step "pnpm test" pnpm test
      ;;
    npm)
      has_package_script test && run_step "npm test" npm test
      ;;
  esac
fi

# Rust detection
if [[ -f Cargo.toml ]] && command -v cargo >/dev/null 2>&1; then
  run_step "cargo check" cargo check --quiet
fi

# Python detection (ruff if available; pytest is too project-specific to default)
if [[ -f pyproject.toml ]] && command -v ruff >/dev/null 2>&1; then
  run_step "ruff check" ruff check .
fi

if [[ "$attempted" -eq 0 ]]; then
  echo "[agent-preflight] No recognized project stack detected; skipping checks." >&2
  exit 0
fi

if [[ "$fail" -ne 0 ]]; then
  echo "[agent-preflight] Verification failed; refusing push." >&2
  echo "[agent-preflight] Fix the issues, or re-run with: gx branch finish --no-preflight ..." >&2
  exit 1
fi

echo "[agent-preflight] ${ran} step(s) passed."
exit 0
