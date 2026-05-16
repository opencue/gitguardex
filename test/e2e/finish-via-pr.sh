#!/usr/bin/env bash
# e2e smoke test for the full `gx branch finish --via-pr --wait-for-merge --cleanup` loop.
#
# This drives the real `bin/multiagent-safety.js` against a throwaway local
# git fixture. There is NO network: `origin` is a local bare repo and `gh`
# is replaced by a bash mock injected through `GUARDEX_GH_BIN`.
#
# Asserts (all required for PASS):
#   * `gx setup` succeeds and the base branch is pushed to the local bare remote.
#   * `gx branch start` creates an agent branch + worktree.
#   * A trivial commit lands in the worktree.
#   * `gx branch finish --via-pr --wait-for-merge --cleanup` exits 0.
#   * The agent commit is merged into the bare remote's base branch.
#   * The agent worktree is pruned.
#   * The local agent branch ref is gone.
#   * The remote agent branch ref is gone.
#
# Runtime budget: well under 60s on GitHub-hosted Ubuntu runners.

set -euo pipefail

# ---- locate repo + CLI ----------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd -P)"
CLI_ENTRY="${REPO_ROOT}/bin/multiagent-safety.js"
if [[ ! -f "${CLI_ENTRY}" ]]; then
  echo "FAIL: CLI entry not found at ${CLI_ENTRY}" >&2
  exit 1
fi

NODE_BIN="${NODE_BIN:-node}"
if ! command -v "${NODE_BIN}" >/dev/null 2>&1; then
  echo "FAIL: node not found in PATH" >&2
  exit 1
fi

# Helper: run `gx ...` with a sanitized env. This script is intended to run
# both from GitHub-hosted runners (clean env) AND locally from inside a
# Guardex agent worktree. In the latter case the inherited shell carries
# `CLAUDECODE`, `CODEX_THREAD_ID`, `GUARDEX_AGENT_*`, etc., which would make
# the CLI think we are reusing the parent worktree's session. Strip those.
run_gx() {
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
    "${NODE_BIN}" "${CLI_ENTRY}" "$@"
}

# ---- isolated scratch dir -------------------------------------------------
SCRATCH="$(mktemp -d -t guardex-e2e-finish-XXXXXX)"
cleanup() {
  rm -rf "${SCRATCH}" || true
}
trap cleanup EXIT

FIXTURE_REPO="${SCRATCH}/fixture"
ORIGIN_DIR="${SCRATCH}/origin.git"
MOCK_BIN_DIR="${SCRATCH}/mock-bin"
GUARDEX_HOME_DIR="${SCRATCH}/guardex-home"
mkdir -p "${MOCK_BIN_DIR}" "${GUARDEX_HOME_DIR}"

# ---- gh mock: drives the local bare origin to perform the merge ----------
# `gx branch finish --via-pr` calls:
#   1. `gh pr create --base <base> --head <branch> --title ... --body ...`
#   2. `gh pr view <branch> --json url --jq '.url'`
#   3. `gh pr merge <branch> --squash --delete-branch`     (or with --auto)
#   4. `gh pr view <branch> --json state,mergedAt,url --jq ...`  (during waits)
#   5. `gh pr list --state merged --head ... --base ... --json ... --jq ...`
#
# The mock performs the *actual* merge by squashing the agent branch into the
# bare origin's base branch via a temporary worktree, so the cleanup assertion
# (`commit landed on base`) is a real merge -- not a stubbed status string.
GH_MOCK_STATE="${SCRATCH}/gh-mock-state"
mkdir -p "${GH_MOCK_STATE}"
cat > "${MOCK_BIN_DIR}/gh" <<'GH_MOCK'
#!/usr/bin/env bash
set -euo pipefail
state_dir="${GUARDEX_E2E_GH_STATE:?GUARDEX_E2E_GH_STATE not set}"
origin_dir="${GUARDEX_E2E_ORIGIN_DIR:?GUARDEX_E2E_ORIGIN_DIR not set}"
base_branch="${GUARDEX_E2E_BASE_BRANCH:?GUARDEX_E2E_BASE_BRANCH not set}"
pr_url_file="${state_dir}/pr-url"
merge_marker="${state_dir}/merged"
log_file="${state_dir}/gh-calls.log"
echo "gh $*" >>"${log_file}"

# Helpers ------------------------------------------------------------------
emit_url() {
  if [[ ! -f "${pr_url_file}" ]]; then
    echo "https://example.invalid/pr/1" >"${pr_url_file}"
  fi
  cat "${pr_url_file}"
}

perform_merge_in_origin() {
  local head_branch="$1"
  if [[ -f "${merge_marker}" ]]; then
    return 0
  fi
  # Materialize a temp worktree off the bare origin, fast-forward base to the
  # agent branch's tree, then push it back as base. Bare repos cannot check
  # out branches directly; the temp clone keeps it simple.
  local merge_workdir
  merge_workdir="$(mktemp -d -t guardex-e2e-merge-XXXXXX)"
  git clone --quiet "${origin_dir}" "${merge_workdir}/repo" >/dev/null
  git -C "${merge_workdir}/repo" config user.email "e2e-bot@example.invalid"
  git -C "${merge_workdir}/repo" config user.name "guardex-e2e"
  git -C "${merge_workdir}/repo" fetch --quiet origin "${head_branch}:${head_branch}"
  git -C "${merge_workdir}/repo" checkout --quiet "${base_branch}"
  # Squash-merge: take the agent tree and commit on base. The squash detail
  # is unimportant -- only "agent file present on base" is asserted.
  git -C "${merge_workdir}/repo" merge --quiet --squash "${head_branch}" >/dev/null
  git -C "${merge_workdir}/repo" commit --quiet -m "Merge ${head_branch} into ${base_branch} (e2e mock)"
  git -C "${merge_workdir}/repo" push --quiet origin "${base_branch}"
  # Mirror `gh pr merge --delete-branch`: drop the remote head branch.
  git -C "${merge_workdir}/repo" push --quiet origin --delete "${head_branch}" || true
  rm -rf "${merge_workdir}"
  : >"${merge_marker}"
}

case "${1:-}" in
  pr)
    shift
    case "${1:-}" in
      create)
        emit_url >/dev/null
        exit 0
        ;;
      view)
        # gh pr view <branch> --json <fields> --jq <expr>
        head_branch="${2:-}"
        # Parse --json field set
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
        if [[ -z "${head_branch}" ]]; then
          echo "mock-gh: pr merge missing branch" >&2
          exit 2
        fi
        perform_merge_in_origin "${head_branch}"
        exit 0
        ;;
      list)
        # Treat list as "nothing previously merged" so the PR flow always
        # creates a fresh PR. read_merged_pr_for_head() expects an empty
        # response to short-circuit.
        printf ''
        exit 0
        ;;
      ready)
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
  "name": "guardex-e2e-fixture",
  "version": "0.0.0",
  "private": true
}
JSON
git -C "${FIXTURE_REPO}" add package.json
git -C "${FIXTURE_REPO}" commit --quiet -m "seed"

git init --quiet --bare "${ORIGIN_DIR}"
git -C "${FIXTURE_REPO}" remote add origin "${ORIGIN_DIR}"
git -C "${FIXTURE_REPO}" push --quiet -u origin main

# ---- run `gx setup` ------------------------------------------------------
echo "==> gx setup"
run_gx setup --target "${FIXTURE_REPO}" --no-global-install

# `gx setup` writes managed files (hooks, gitignore, scripts). Commit them so
# the agent branch base is clean.
git -C "${FIXTURE_REPO}" add -A
ALLOW_COMMIT_ON_PROTECTED_BRANCH=1 git -C "${FIXTURE_REPO}" commit --quiet -m "apply gx setup"
ALLOW_PUSH_ON_PROTECTED_BRANCH=1 git -C "${FIXTURE_REPO}" push --quiet origin main

# ---- run `gx branch start` ----------------------------------------------
# `gx branch start` infers the target repo from CWD. Drop into the fixture
# AND scrub any inherited agent-session env vars so the CLI does not try to
# reuse the parent shell's worktree/branch context (which is what happens
# when this script is invoked from inside an `agent/...` worktree).
echo "==> gx branch start"
BRANCH_START_OUT="${SCRATCH}/branch-start.out"
(
  cd "${FIXTURE_REPO}"
  run_gx branch start --tier T1 e2e-finish bot
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
TRIVIAL_FILE="e2e-finish-marker.txt"
echo "guardex e2e: this file proves the agent commit landed on base." \
  >"${AGENT_WORKTREE}/${TRIVIAL_FILE}"

# Claim the file before commit (lock guard runs in pre-commit on agent/*).
(
  cd "${FIXTURE_REPO}"
  run_gx locks claim --branch "${AGENT_BRANCH}" "${TRIVIAL_FILE}"
)

git -C "${AGENT_WORKTREE}" add "${TRIVIAL_FILE}"
git -C "${AGENT_WORKTREE}" commit --quiet -m "e2e: trivial change for finish smoke test"

AGENT_COMMIT_SHA="$(git -C "${AGENT_WORKTREE}" rev-parse HEAD)"
echo "    agent commit: ${AGENT_COMMIT_SHA}"

# ---- run `gx branch finish --via-pr --wait-for-merge --cleanup` ----------
echo "==> gx branch finish --via-pr --wait-for-merge --cleanup"
FINISH_OUT="${SCRATCH}/branch-finish.out"
set +e
(
  cd "${FIXTURE_REPO}"
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
    PATH="${MOCK_BIN_DIR}:${PATH}" \
    GUARDEX_GH_BIN="${MOCK_BIN_DIR}/gh" \
    GUARDEX_E2E_GH_STATE="${GH_MOCK_STATE}" \
    GUARDEX_E2E_ORIGIN_DIR="${ORIGIN_DIR}" \
    GUARDEX_E2E_BASE_BRANCH="main" \
    GUARDEX_HOME_DIR="${GUARDEX_HOME_DIR}" \
    "${NODE_BIN}" "${CLI_ENTRY}" branch finish \
    --branch "${AGENT_BRANCH}" \
    --base main \
    --via-pr \
    --wait-for-merge \
    --wait-timeout-seconds 30 \
    --wait-poll-seconds 0 \
    --cleanup
) >"${FINISH_OUT}" 2>&1
FINISH_STATUS=$?
set -e
cat "${FINISH_OUT}"

if [[ "${FINISH_STATUS}" -ne 0 ]]; then
  echo "FAIL: gx branch finish exited with status ${FINISH_STATUS}" >&2
  echo "---- gh mock call log ----" >&2
  cat "${GH_MOCK_STATE}/gh-calls.log" >&2 || true
  exit 1
fi

# ---- assertions ----------------------------------------------------------
echo "==> assertions"

# 1) Mock observed the PR create + merge sequence.
if ! grep -q '^gh pr create' "${GH_MOCK_STATE}/gh-calls.log"; then
  echo "FAIL: mock gh never received 'pr create'" >&2
  exit 1
fi
if ! grep -q '^gh pr merge' "${GH_MOCK_STATE}/gh-calls.log"; then
  echo "FAIL: mock gh never received 'pr merge'" >&2
  exit 1
fi
echo "    OK: gh mock saw pr create + pr merge"

# 2) Agent commit's file is now on origin's base branch.
ORIGIN_TREE_CHECK="$(mktemp -d -t guardex-e2e-verify-XXXXXX)"
git clone --quiet "${ORIGIN_DIR}" "${ORIGIN_TREE_CHECK}/repo"
if [[ ! -f "${ORIGIN_TREE_CHECK}/repo/${TRIVIAL_FILE}" ]]; then
  echo "FAIL: agent file '${TRIVIAL_FILE}' did not land on origin/main" >&2
  rm -rf "${ORIGIN_TREE_CHECK}"
  exit 1
fi
rm -rf "${ORIGIN_TREE_CHECK}"
echo "    OK: agent commit landed on origin/main"

# 3) Cleanup: local agent branch is gone.
if git -C "${FIXTURE_REPO}" show-ref --verify --quiet "refs/heads/${AGENT_BRANCH}"; then
  echo "FAIL: local agent branch still exists after cleanup" >&2
  exit 1
fi
echo "    OK: local agent branch removed"

# 4) Cleanup: remote agent branch is gone.
if git -C "${FIXTURE_REPO}" ls-remote --exit-code --heads origin "${AGENT_BRANCH}" >/dev/null 2>&1; then
  echo "FAIL: remote agent branch still exists after cleanup" >&2
  exit 1
fi
echo "    OK: remote agent branch removed"

# 5) Cleanup: agent worktree directory is pruned.
if [[ -d "${AGENT_WORKTREE}" ]]; then
  echo "FAIL: agent worktree still on disk after --cleanup: ${AGENT_WORKTREE}" >&2
  exit 1
fi
echo "    OK: agent worktree pruned"

# 6) Finish flow announced success.
if ! grep -qE "Merged '${AGENT_BRANCH}' into 'main' via pr flow" "${FINISH_OUT}"; then
  echo "FAIL: finish output missing the 'Merged ... via pr flow' confirmation" >&2
  exit 1
fi
echo "    OK: finish reported pr-flow merge success"

echo
echo "PASS: gx branch finish --via-pr --wait-for-merge --cleanup completed end-to-end."
