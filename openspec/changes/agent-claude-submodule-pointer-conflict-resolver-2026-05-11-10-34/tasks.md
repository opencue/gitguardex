# Tasks

## 1. Spec

- [x] 1.1 Capture problem + approach in `proposal.md` (includes drift finding).
- [x] 1.2 Add ADDED/MODIFIED requirements + scenarios to `specs/gitguardex-agent-lifecycle/spec.md`.

## 2. Port Phase 1+2 to `templates/scripts/`

- [x] 2.1 `templates/scripts/agent-branch-start.sh`: add `AUTO_TRANSFER_ENABLED_RAW` / `AUTO_TRANSFER_EXCLUDE_RAW` env defaults.
- [x] 2.2 `templates/scripts/agent-branch-start.sh`: add `--no-transfer`, `--transfer`, `--transfer-exclude` flags.
- [x] 2.3 `templates/scripts/agent-branch-start.sh`: replace auto-transfer block with pathspec-exclude variant + log lines.
- [x] 2.4 `templates/scripts/agent-branch-finish.sh`: add `AUTO_RESOLVE_MODE_RAW` / `AUTO_RESOLVE_SAFE_GLOBS_RAW` env defaults.
- [x] 2.5 `templates/scripts/agent-branch-finish.sh`: add `--auto-resolve` / `--auto-resolve=*` / `--no-auto-resolve` flags + validation case for `none|safe|full`.
- [x] 2.6 `templates/scripts/agent-branch-finish.sh`: add `path_matches_auto_resolve_safe_glob` helper.
- [x] 2.7 `templates/scripts/agent-branch-finish.sh`: rewrite preflight conflict block with safe + full resolver + `gx locks claim` integration.

## 3. Phase 3 — `--auto-resolve=full` submodule pointer resolver

- [x] 3.1 `scripts/agent-branch-finish.sh`: extend `--auto-resolve` arg regex + validation to accept `full`.
- [x] 3.2 `scripts/agent-branch-finish.sh`: add `try_resolve_submodule_pointer_conflict` helper with 3-source clone lookup (worktree → `.git/modules/<name>` → temp bare clone).
- [x] 3.3 `scripts/agent-branch-finish.sh`: integrate submodule resolver into the conflict-walk loop (only when mode == `full`).
- [x] 3.4 `scripts/agent-branch-finish.sh`: update commit message + summary lines for state + submodule counts.
- [x] 3.5 Mirror 3.1–3.4 into `templates/scripts/agent-branch-finish.sh`.

## 4. Tests / Verification

- [x] 4.1 `bash -n` clean on all four edited scripts.
- [x] 4.2 Arg-parser smoke: `bash <finish> --auto-resolve=full --branch x` parses without "Unknown argument"; `--auto-resolve=bogus` is rejected with the right enum error.
- [x] 4.3 Manual reproduction of the drift bug: confirm `gx branch start --no-transfer ...` now works against `templates/scripts/` (verified by dogfooding `--no-transfer` in this session to start this branch).

## 5. Cleanup

- [ ] 5.1 Commit on `agent/claude/submodule-pointer-conflict-resolver-2026-05-11-10-34`.
- [ ] 5.2 Push branch and open PR against `main`.
- [ ] 5.3 PR merged (record URL + MERGED state).
- [ ] 5.4 Sandbox worktree pruned via `gx branch finish --cleanup`.
