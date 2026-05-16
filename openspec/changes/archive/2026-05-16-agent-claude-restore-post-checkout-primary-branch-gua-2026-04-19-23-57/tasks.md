## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for
  `agent-claude-restore-post-checkout-primary-branch-gua-2026-04-19-23-57`.
- [x] 1.2 Define normative requirements in
  `specs/primary-checkout-immutability/spec.md`.

## 2. Implementation

- [x] 2.1 Restore `templates/githooks/post-checkout` from git history
  (commit `c6d4dc3`, byte-for-byte).
- [x] 2.2 Install hook as `.githooks/post-checkout` (executable).
- [x] 2.3 Re-wire `bin/multiagent-safety.js`: add the hook to
  `TEMPLATE_FILES`, `EXECUTABLE_RELATIVE_PATHS`, `CRITICAL_GUARDRAIL_PATHS`,
  and `MANAGED_GITIGNORE_PATHS`.
- [x] 2.4 Add the primary-checkout rule + bypass to
  `templates/AGENTS.multiagent-safety.md` and the installed `AGENTS.md`
  marker block.
- [x] 2.5 Bump `package.json` version from `7.0.0` to `7.0.1`.

## 3. Verification

- [x] 3.1 `bash -n templates/githooks/post-checkout` and
  `bash -n .githooks/post-checkout` — both pass.
- [x] 3.2 `diff templates/githooks/post-checkout <(git show c6d4dc3:templates/githooks/post-checkout)`
  is empty (byte-for-byte match with v6.1.0 source).
- [x] 3.3 `grep -cE "'githooks/post-checkout'|'\.githooks/post-checkout'" bin/multiagent-safety.js`
  returns `4`.
- [x] 3.4 Run `openspec validate agent-claude-restore-post-checkout-primary-branch-gua-2026-04-19-23-57 --type change --strict` — valid.
- [x] 3.5 Run `openspec validate --specs` — no main specs to validate (passes).

## 4. Cleanup (mandatory; run before claiming completion)

- [x] 4.1 Run `bash scripts/agent-branch-finish.sh --branch agent/claude/restore-post-checkout-primary-branch-gua-2026-04-19-23-57 --base main --via-pr --wait-for-merge --cleanup`.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`).
- [x] 4.3 Confirm sandbox worktree is gone and primary checkout returns to `main`.
- [x] 4.4 (Optional, user-driven) Publish to npm: `npm publish` (version 7.0.1).
