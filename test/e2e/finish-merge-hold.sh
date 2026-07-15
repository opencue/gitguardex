#!/usr/bin/env bash
# e2e lifecycle test for the `--no-auto-promote` MERGE HOLD in
# `gx branch finish --via-pr`.
#
# Regression under test: run_pr_flow used to run an unconditional
# `gh pr merge` right after `gh pr create`, so on a repo with no blocking
# checks the PR landed instantly and `--no-auto-promote` changed nothing.
# The hold must also be PERSISTED (guardex:merge-hold marker in the PR
# body): an unflagged re-run — the Claude stop hook, the doctor sweep,
# `gx finish --all` — must NOT lift it; only an explicit `--auto-promote`
# finish may.
#
# Same harness as finish-via-pr.sh: local bare origin, stateful bash mock
# for `gh` injected through `GUARDEX_GH_BIN`, no network.
#
# Stage 1  finish --no-auto-promote      → draft PR, marker placed, no merge,
#                                          exit 0, worktree retained
# Stage 2  finish (no flag; stop-hook    → hold honored: no promote, no merge,
#          shape)                          marker + draft retained, exit 0
# Stage 3  finish --auto-promote         → marker removed, PR promoted, merged,
#                                          cleaned up

set -euo pipefail

# ---- locate repo + CLI ----------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd -P)"
CLI_ENTRY="${REPO_ROOT}/bin/multiagent-safety.js"
if [[ ! -f "${CLI_ENTRY}" ]]; then
  echo "FAIL: CLI entry not found at ${CLI_ENTRY}" >&2
  exit 1
fi

NODE_BIN_NAME="${NODE_BIN:-node}"
if ! NODE_BIN_RESOLVED="$(command -v "${NODE_BIN_NAME}" 2>/dev/null)"; then
  echo "FAIL: node not found in PATH (looked for '${NODE_BIN_NAME}')" >&2
  exit 1
fi
NODE_BIN="${NODE_BIN_RESOLVED}"

export GUARDEX_CLI_ENTRY="${CLI_ENTRY}"
export GUARDEX_NODE_BIN="${NODE_BIN}"

# Strip agent-session env so the CLI (and the git hooks it installs) treat the
# fixture as a fresh human checkout even when this script runs from inside a
# Claude/Codex agent worktree.
run_clean() {
  env \
    -u CODEX_THREAD_ID \
    -u OMX_SESSION_ID \
    -u CODEX_CI \
    -u CLAUDECODE \
    -u CLAUDE_CODE_SESSION_ID \
    -u GUARDEX_AGENT_BRANCH \
    -u GUARDEX_AGENT_WORKTREE \
    -u GIT_DIR \
    -u GIT_WORK_TREE \
    GUARDEX_HOME_DIR="${GUARDEX_HOME_DIR}" \
    GUARDEX_CLI_ENTRY="${CLI_ENTRY}" \
    GUARDEX_NODE_BIN="${NODE_BIN}" \
    "$@"
}

run_gx() {
  run_clean "${NODE_BIN}" "${CLI_ENTRY}" "$@"
}

# ---- isolated scratch dir -------------------------------------------------
SCRATCH="$(mktemp -d -t guardex-e2e-hold-XXXXXX)"
cleanup() {
  rm -rf "${SCRATCH}" || true
}
trap cleanup EXIT

FIXTURE_REPO="${SCRATCH}/fixture"
ORIGIN_DIR="${SCRATCH}/origin.git"
MOCK_BIN_DIR="${SCRATCH}/mock-bin"
export GUARDEX_HOME_DIR="${SCRATCH}/guardex-home"
mkdir -p "${MOCK_BIN_DIR}" "${GUARDEX_HOME_DIR}"

# ---- stateful gh mock -----------------------------------------------------
# Tracks PR body (for the hold marker), draft state, and merged state.
# `pr merge` on a draft fails like real gh; a real merge squashes into the
# bare origin so post-merge assertions are genuine.
GH_MOCK_STATE="${SCRATCH}/gh-mock-state"
mkdir -p "${GH_MOCK_STATE}"
cat > "${MOCK_BIN_DIR}/gh" <<'GH_MOCK'
#!/usr/bin/env bash
set -euo pipefail
state_dir="${GUARDEX_E2E_GH_STATE:?GUARDEX_E2E_GH_STATE not set}"
origin_dir="${GUARDEX_E2E_ORIGIN_DIR:?GUARDEX_E2E_ORIGIN_DIR not set}"
base_branch="${GUARDEX_E2E_BASE_BRANCH:?GUARDEX_E2E_BASE_BRANCH not set}"
pr_url_file="${state_dir}/pr-url"
pr_body_file="${state_dir}/pr-body"
pr_draft_file="${state_dir}/pr-draft"
merge_marker="${state_dir}/merged"
log_file="${state_dir}/gh-calls.log"
echo "gh $*" >>"${log_file}"

emit_url() {
  if [[ ! -f "${pr_url_file}" ]]; then
    echo "https://example.invalid/pr/1" >"${pr_url_file}"
  fi
  cat "${pr_url_file}"
}

read_body() {
  cat "${pr_body_file}" 2>/dev/null || printf ''
}

read_draft() {
  cat "${pr_draft_file}" 2>/dev/null || printf 'false'
}

perform_merge_in_origin() {
  local head_branch="$1"
  if [[ -f "${merge_marker}" ]]; then
    return 0
  fi
  local merge_workdir
  merge_workdir="$(mktemp -d -t guardex-e2e-merge-XXXXXX)"
  git clone --quiet "${origin_dir}" "${merge_workdir}/repo" >/dev/null 2>&1
  git -C "${merge_workdir}/repo" config user.email "e2e-bot@example.invalid"
  git -C "${merge_workdir}/repo" config user.name "guardex-e2e"
  git -C "${merge_workdir}/repo" fetch --quiet origin "${head_branch}:${head_branch}"
  git -C "${merge_workdir}/repo" checkout --quiet "${base_branch}"
  git -C "${merge_workdir}/repo" merge --quiet --squash "${head_branch}" >/dev/null
  git -C "${merge_workdir}/repo" commit --quiet -m "Merge ${head_branch} into ${base_branch} (e2e mock)"
  git -C "${merge_workdir}/repo" push --quiet origin "${base_branch}"
  git -C "${merge_workdir}/repo" push --quiet origin --delete "${head_branch}" || true
  rm -rf "${merge_workdir}"
  : >"${merge_marker}"
}

case "${1:-}" in
  pr)
    shift
    case "${1:-}" in
      create)
        # Record draft-ness and initial body from the create args.
        shift
        is_draft="false"
        body=""
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --draft) is_draft="true"; shift ;;
            --body) body="${2:-}"; shift 2 ;;
            *) shift ;;
          esac
        done
        if [[ ! -f "${pr_url_file}" ]]; then
          echo "${is_draft}" >"${pr_draft_file}"
          printf '%s' "${body}" >"${pr_body_file}"
        fi
        emit_url >/dev/null
        exit 0
        ;;
      edit)
        shift
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --body) printf '%s' "${2:-}" >"${pr_body_file}"; shift 2 ;;
            *) shift ;;
          esac
        done
        exit 0
        ;;
      ready)
        if [[ "${2:-}" == "--undo" || "${3:-}" == "--undo" ]]; then
          echo "true" >"${pr_draft_file}"
        else
          echo "false" >"${pr_draft_file}"
        fi
        exit 0
        ;;
      view)
        json_fields=""
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --json) json_fields="$2"; shift 2 ;;
            *) shift ;;
          esac
        done
        case "${json_fields}" in
          url)
            emit_url
            ;;
          body)
            read_body
            echo
            ;;
          isDraft)
            read_draft
            ;;
          state,mergedAt,url)
            if [[ -f "${merge_marker}" ]]; then
              printf 'MERGED\x1f2026-01-01T00:00:00Z\x1f%s\n' "$(emit_url)"
            else
              printf 'OPEN\x1f\x1f%s\n' "$(emit_url)"
            fi
            ;;
          *)
            echo "mock-gh: unsupported pr view --json '${json_fields}'" >&2
            exit 2
            ;;
        esac
        exit 0
        ;;
      merge)
        head_branch="${2:-}"
        for arg in "$@"; do
          if [[ "${arg}" == "--disable-auto" ]]; then
            # Disarming auto-merge is a hold-side no-op here.
            exit 0
          fi
        done
        if [[ "$(read_draft)" == "true" ]]; then
          echo "mock-gh: Pull request is still a draft and cannot be merged" >&2
          exit 1
        fi
        if [[ -z "${head_branch}" ]]; then
          echo "mock-gh: pr merge missing branch" >&2
          exit 2
        fi
        perform_merge_in_origin "${head_branch}"
        exit 0
        ;;
      list)
        printf ''
        exit 0
        ;;
      *)
        echo "mock-gh: unsupported pr subcommand '${1:-}'" >&2
        exit 2
        ;;
    esac
    ;;
  *)
    echo "mock-gh: unsupported top-level '${1:-}'" >&2
    exit 2
    ;;
esac
GH_MOCK
chmod +x "${MOCK_BIN_DIR}/gh"

# ---- build fixture repo + bare origin -----------------------------------
mkdir -p "${FIXTURE_REPO}"
git init --quiet --initial-branch=main "${FIXTURE_REPO}"
git -C "${FIXTURE_REPO}" config user.email "e2e-bot@example.invalid"
git -C "${FIXTURE_REPO}" config user.name "guardex-e2e"
cat >"${FIXTURE_REPO}/package.json" <<JSON
{
  "name": "guardex-e2e-hold-fixture",
  "version": "0.0.0",
  "private": true
}
JSON
git -C "${FIXTURE_REPO}" add package.json
git -C "${FIXTURE_REPO}" commit --quiet -m "seed"

git init --quiet --bare --initial-branch=main "${ORIGIN_DIR}"
git -C "${FIXTURE_REPO}" remote add origin "${ORIGIN_DIR}"
run_clean git -C "${FIXTURE_REPO}" push --quiet -u origin main

# ---- run `gx setup` ------------------------------------------------------
echo "==> gx setup"
run_gx setup --target "${FIXTURE_REPO}" --no-global-install

git -C "${FIXTURE_REPO}" add -A
run_clean env ALLOW_COMMIT_ON_PROTECTED_BRANCH=1 git -C "${FIXTURE_REPO}" commit --quiet -m "apply gx setup"
run_clean env ALLOW_PUSH_ON_PROTECTED_BRANCH=1 git -C "${FIXTURE_REPO}" push --quiet origin main

# ---- run `gx branch start` ----------------------------------------------
echo "==> gx branch start"
BRANCH_START_OUT="${SCRATCH}/branch-start.out"
(
  cd "${FIXTURE_REPO}"
  run_gx branch start --tier T1 e2e-hold bot
) >"${BRANCH_START_OUT}" 2>&1
cat "${BRANCH_START_OUT}"

AGENT_BRANCH="$(grep -oE '\[agent-branch-start\] Created branch: .+' "${BRANCH_START_OUT}" | head -1 | sed 's/^\[agent-branch-start\] Created branch: //')"
AGENT_WORKTREE="$(grep -oE '\[agent-branch-start\] Worktree: .+' "${BRANCH_START_OUT}" | head -1 | sed 's/^\[agent-branch-start\] Worktree: //')"
if [[ -z "${AGENT_BRANCH}" || -z "${AGENT_WORKTREE}" ]]; then
  echo "FAIL: could not parse agent branch/worktree from gx branch start output" >&2
  exit 1
fi
echo "    agent branch:   ${AGENT_BRANCH}"
echo "    agent worktree: ${AGENT_WORKTREE}"

# ---- commit a trivial change inside the agent worktree -------------------
echo "==> commit trivial change in agent worktree"
TRIVIAL_FILE="e2e-hold-marker.txt"
echo "guardex e2e: this file must NOT land on base while the merge is held." \
  >"${AGENT_WORKTREE}/${TRIVIAL_FILE}"

(
  cd "${FIXTURE_REPO}"
  run_gx locks claim --branch "${AGENT_BRANCH}" "${TRIVIAL_FILE}"
)

git -C "${AGENT_WORKTREE}" add "${TRIVIAL_FILE}"
git -C "${AGENT_WORKTREE}" commit --quiet -m "e2e: change held behind --no-auto-promote"

# ---- shared finish runner -------------------------------------------------
run_finish() {
  local out_file="$1"
  shift
  set +e
  (
    cd "${FIXTURE_REPO}"
    run_clean env \
      PATH="${MOCK_BIN_DIR}:${PATH}" \
      GUARDEX_GH_BIN="${MOCK_BIN_DIR}/gh" \
      GUARDEX_E2E_GH_STATE="${GH_MOCK_STATE}" \
      GUARDEX_E2E_ORIGIN_DIR="${ORIGIN_DIR}" \
      GUARDEX_E2E_BASE_BRANCH="main" \
      "${NODE_BIN}" "${CLI_ENTRY}" branch finish \
      --branch "${AGENT_BRANCH}" \
      --base main \
      --via-pr \
      --wait-for-merge \
      --wait-timeout-seconds 30 \
      --wait-poll-seconds 0 \
      --cleanup \
      "$@"
  ) >"${out_file}" 2>&1
  local status=$?
  set -e
  return "${status}"
}

assert_no_real_merge() {
  if grep '^gh pr merge' "${GH_MOCK_STATE}/gh-calls.log" | grep -qv -- '--disable-auto'; then
    echo "FAIL: a real 'gh pr merge' was attempted while the merge is held" >&2
    cat "${GH_MOCK_STATE}/gh-calls.log" >&2 || true
    exit 1
  fi
}

assert_not_on_base() {
  if git -C "${ORIGIN_DIR}" ls-tree -r main --name-only | grep -qx "${TRIVIAL_FILE}"; then
    echo "FAIL: agent file '${TRIVIAL_FILE}' landed on origin/main despite the hold" >&2
    exit 1
  fi
}

# ---- stage 1: place the hold ----------------------------------------------
echo "==> stage 1: gx branch finish --no-auto-promote (place hold)"
FINISH_OUT_1="${SCRATCH}/finish-1.out"
if ! run_finish "${FINISH_OUT_1}" --no-auto-promote; then
  cat "${FINISH_OUT_1}"
  echo "FAIL: held finish exited non-zero (must exit 0)" >&2
  exit 1
fi
cat "${FINISH_OUT_1}"

if ! grep -q '^gh pr create .*--draft' "${GH_MOCK_STATE}/gh-calls.log"; then
  echo "FAIL: mock gh never received 'pr create ... --draft'" >&2
  cat "${GH_MOCK_STATE}/gh-calls.log" >&2 || true
  exit 1
fi
echo "    OK: PR created as draft"
assert_no_real_merge
echo "    OK: no real gh pr merge call"
if ! grep -q 'guardex:merge-hold' "${GH_MOCK_STATE}/pr-body"; then
  echo "FAIL: hold marker not persisted to the PR body" >&2
  exit 1
fi
echo "    OK: hold marker persisted on the PR"
if ! grep -q 'MERGE_HELD=1' "${FINISH_OUT_1}"; then
  echo "FAIL: held finish did not print the MERGE_HELD=1 trailer" >&2
  exit 1
fi
echo "    OK: MERGE_HELD=1 trailer printed"
assert_not_on_base
echo "    OK: agent commit did not reach origin/main"

# ---- stage 2: unflagged re-run must NOT lift the hold ----------------------
echo "==> stage 2: gx branch finish (no flag) — hold must survive"
FINISH_OUT_2="${SCRATCH}/finish-2.out"
if ! run_finish "${FINISH_OUT_2}"; then
  cat "${FINISH_OUT_2}"
  echo "FAIL: unflagged re-run on a held lane exited non-zero" >&2
  exit 1
fi
cat "${FINISH_OUT_2}"

if ! grep -q 'merge hold' "${FINISH_OUT_2}"; then
  echo "FAIL: unflagged re-run did not report the existing merge hold" >&2
  exit 1
fi
assert_no_real_merge
echo "    OK: unflagged re-run attempted no merge"
if [[ "$(cat "${GH_MOCK_STATE}/pr-draft")" != "true" ]]; then
  echo "FAIL: unflagged re-run promoted the held draft PR" >&2
  exit 1
fi
echo "    OK: PR still draft, hold not lifted"
if ! grep -q 'guardex:merge-hold' "${GH_MOCK_STATE}/pr-body"; then
  echo "FAIL: hold marker vanished on the unflagged re-run" >&2
  exit 1
fi
echo "    OK: hold marker still present"
assert_not_on_base
echo "    OK: agent commit still not on origin/main"
if [[ ! -d "${AGENT_WORKTREE}" ]]; then
  echo "FAIL: agent worktree was pruned while the merge is held" >&2
  exit 1
fi
echo "    OK: worktree retained"

# ---- stage 3: explicit --auto-promote lifts the hold and merges ------------
echo "==> stage 3: gx branch finish --auto-promote (lift hold)"
FINISH_OUT_3="${SCRATCH}/finish-3.out"
if ! run_finish "${FINISH_OUT_3}" --auto-promote; then
  cat "${FINISH_OUT_3}"
  echo "FAIL: lifting finish exited non-zero" >&2
  cat "${GH_MOCK_STATE}/gh-calls.log" >&2 || true
  exit 1
fi
cat "${FINISH_OUT_3}"

if grep -q 'guardex:merge-hold' "${GH_MOCK_STATE}/pr-body"; then
  echo "FAIL: hold marker still on the PR after --auto-promote" >&2
  exit 1
fi
echo "    OK: hold marker removed"
if ! git -C "${ORIGIN_DIR}" ls-tree -r main --name-only | grep -qx "${TRIVIAL_FILE}"; then
  echo "FAIL: agent file did not land on origin/main after the hold was lifted" >&2
  exit 1
fi
echo "    OK: agent commit merged to origin/main"
if [[ -d "${AGENT_WORKTREE}" ]]; then
  echo "FAIL: agent worktree still on disk after lifted finish --cleanup" >&2
  exit 1
fi
echo "    OK: worktree pruned after merge"

echo
echo "PASS: merge hold lifecycle — placed, survived an unflagged re-run, lifted only by explicit --auto-promote."
