## Why

- The Guardex CLI still had a few workflow regressions after the recent protected-main and finish-flow fixes landed on `main`.
- `agent-branch-finish.sh` could still fall back to `dev` in repos that only expose `main`, which makes cleanup and merge automation choose the wrong base.
- `agent-branch-start.sh` still collapsed explicit agent roles to `codex`, which hid real lane ownership in branch names and made the runtime/test surface drift from the intended role-based contract.
- `codex-agent.sh` still attempted PR auto-finish in local/file-remote repos that do not expose a mergeable GitHub PR surface, leaving the session on a finish path that could never succeed.

## What Changes

- Teach `agent-branch-finish.sh` and its template to fall back through `dev`, `main`, and `master` before defaulting so main-only repos finish against a real base branch.
- Preserve explicit role tokens in `agent-branch-start.sh` and its template, while keeping the legacy `claude`, `codex`, and `bot -> codex` compatibility paths intact.
- Gate `codex-agent.sh` auto-finish on a real mergeable remote context and refresh focused regression coverage in `test/install.test.js` and `scripts/test-agent-naming.sh` so the suite matches the current Guardex workflow contract.

## Impact

- Affected runtime surfaces:
  - `scripts/agent-branch-finish.sh`
  - `scripts/agent-branch-start.sh`
  - `scripts/codex-agent.sh`
  - matching templates under `templates/scripts/`
- Affected regression coverage:
  - `test/install.test.js`
  - `scripts/test-agent-naming.sh`
- Risk is moderate because the patch touches branch creation, finish, and auto-finish orchestration, but the blast radius stays inside Guardex workflow scripts and their regression suite.
