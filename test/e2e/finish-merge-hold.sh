#!/usr/bin/env bash
# e2e smoke test for the `--no-auto-promote` MERGE HOLD in
# `gx branch finish --via-pr`.
#
# Regression under test: run_pr_flow used to run an unconditional
# `gh pr merge` right after `gh pr create`, so on a repo with no blocking
# checks the PR landed instantly and `--no-auto-promote` changed nothing.
# The hold must (a) open the PR as a draft, (b) never attempt a merge,
# (c) exit 0 with the branch + worktree retained.
#
# Same harness as finish-via-pr.sh: local bare origin, bash mock for `gh`
# injected through `GUARDEX_GH_BIN`, no network.
#
# Asserts (all required for PASS):
#   * `gx branch finish --via-pr --cleanup --no-auto-promote` exits 0.
#   * The gh mock received `pr create` WITH `--draft`.
#   * The gh mock NEVER received `pr merge`.
#   * The finish output announces the merge hold.
#   * The agent commit did NOT land on origin's base branch.
#   * The local agent branch, remote agent branch, and worktree all remain.

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
    GUARDEX_CLI_ENTRY="${CLI_ENTRY}" \
    GUARDEX_NODE_BIN="${NODE_BIN}" \
    "${NODE_BIN}" "${CLI_ENTRY}" "$@"
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

# ---- gh mock: records calls; a `pr merge` call is the FAILURE signal ------
GH_MOCK_STATE="${SCRATCH}/gh-mock-state"
mkdir -p "${GH_MOCK_STATE}"
cat > "${MOCK_BIN_DIR}/gh" <<'GH_MOCK'
#!/usr/bin/env bash
set -euo pipefail
state_dir="${GUARDEX_E2E_GH_STATE:?GUARDEX_E2E_GH_STATE not set}"
pr_url_file="${state_dir}/pr-url"
log_file="${state_dir}/gh-calls.log"
echo "gh $*" >>"${log_file}"

emit_url() {
  if [[ ! -f "${pr_url_file}" ]]; then
    echo "https://example.invalid/pr/1" >"${pr_url_file}"
  fi
  cat "${pr_url_file}"
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
          isDraft)
            echo "true"
            ;;
          state,mergedAt,url)
            printf 'OPEN\x1f\x1f%s\n' "$(emit_url)"
            ;;
          *)
            echo "mock-gh: unsupported pr view --json '${json_fields}'" >&2
            exit 2
            ;;
        esac
        exit 0
        ;;
      merge)
        # The hold must prevent this call entirely. Log already captured it;
        # fail loudly so a regression cannot silently "merge".
        echo "mock-gh: pr merge called despite --no-auto-promote hold" >&2
        exit 2
        ;;
      list)
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
  "name": "guardex-e2e-hold-fixture",
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

git -C "${FIXTURE_REPO}" add -A
ALLOW_COMMIT_ON_PROTECTED_BRANCH=1 git -C "${FIXTURE_REPO}" commit --quiet -m "apply gx setup"
ALLOW_PUSH_ON_PROTECTED_BRANCH=1 git -C "${FIXTURE_REPO}" push --quiet origin main

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

# ---- run `gx branch finish --via-pr --cleanup --no-auto-promote` ----------
echo "==> gx branch finish --via-pr --cleanup --no-auto-promote"
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
    GUARDEX_HOME_DIR="${GUARDEX_HOME_DIR}" \
    GUARDEX_CLI_ENTRY="${CLI_ENTRY}" \
    GUARDEX_NODE_BIN="${NODE_BIN}" \
    "${NODE_BIN}" "${CLI_ENTRY}" branch finish \
    --branch "${AGENT_BRANCH}" \
    --base main \
    --via-pr \
    --cleanup \
    --no-auto-promote
) >"${FINISH_OUT}" 2>&1
FINISH_STATUS=$?
set -e
cat "${FINISH_OUT}"

# ---- assertions ----------------------------------------------------------
echo "==> assertions"

# 1) Held finish exits 0 (intentional hold, not a failure).
if [[ "${FINISH_STATUS}" -ne 0 ]]; then
  echo "FAIL: gx branch finish exited with status ${FINISH_STATUS} (held merge must exit 0)" >&2
  echo "---- gh mock call log ----" >&2
  cat "${GH_MOCK_STATE}/gh-calls.log" >&2 || true
  exit 1
fi
echo "    OK: finish exited 0"

# 2) PR was created as a draft.
if ! grep -q '^gh pr create .*--draft' "${GH_MOCK_STATE}/gh-calls.log"; then
  echo "FAIL: mock gh never received 'pr create ... --draft'" >&2
  cat "${GH_MOCK_STATE}/gh-calls.log" >&2 || true
  exit 1
fi
echo "    OK: PR created as draft"

# 3) No merge was ever attempted.
if grep -q '^gh pr merge' "${GH_MOCK_STATE}/gh-calls.log"; then
  echo "FAIL: mock gh received 'pr merge' despite --no-auto-promote" >&2
  cat "${GH_MOCK_STATE}/gh-calls.log" >&2 || true
  exit 1
fi
echo "    OK: no gh pr merge call"

# 4) Finish output announced the hold.
if ! grep -q 'Merge held' "${FINISH_OUT}"; then
  echo "FAIL: finish output missing the 'Merge held' notice" >&2
  exit 1
fi
echo "    OK: finish announced the merge hold"

# 5) Agent commit did NOT land on origin's base branch. Checked with ls-tree
# against the bare origin directly — a clone-based file check silently passes
# when the bare repo's HEAD doesn't resolve (no checkout, no file).
if git -C "${ORIGIN_DIR}" ls-tree -r main --name-only | grep -qx "${TRIVIAL_FILE}"; then
  echo "FAIL: agent file '${TRIVIAL_FILE}' landed on origin/main despite the hold" >&2
  exit 1
fi
echo "    OK: agent commit did not reach origin/main"

# 6) Branch + worktree retained so the gate can run and the finish can rerun.
if ! git -C "${FIXTURE_REPO}" show-ref --verify --quiet "refs/heads/${AGENT_BRANCH}"; then
  echo "FAIL: local agent branch was deleted while the merge is held" >&2
  exit 1
fi
if ! git -C "${FIXTURE_REPO}" ls-remote --exit-code --heads origin "${AGENT_BRANCH}" >/dev/null 2>&1; then
  echo "FAIL: remote agent branch was deleted while the merge is held" >&2
  exit 1
fi
if [[ ! -d "${AGENT_WORKTREE}" ]]; then
  echo "FAIL: agent worktree was pruned while the merge is held" >&2
  exit 1
fi
echo "    OK: local branch, remote branch, and worktree retained"

echo
echo "PASS: --no-auto-promote held the merge end-to-end (draft PR, no merge, state retained)."
