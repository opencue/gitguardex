## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-codex-restore-agents-hook-bridge-2026-04-20-08-45`.
- [x] 1.2 Define normative requirements in `specs/restore-agents-hook-bridge/spec.md`.

## 2. Implementation

- [x] 2.1 Implement scoped behavior changes.
- [x] 2.2 Add/update focused regression coverage.

## 3. Verification

- [x] 3.1 Run targeted project verification commands.
- [x] 3.2 Run `openspec validate agent-codex-restore-agents-hook-bridge-2026-04-20-08-45 --type change --strict`.
- [x] 3.3 Run `openspec validate --specs`.

## 4. Cleanup

- [x] 4.1 Confirm branch is ready for finish.
- [x] 4.2 After successful merge, run `bash scripts/agent-worktree-prune.sh --base <base> --delete-branches --delete-remote-branches` so merged agent branch/worktree sandboxes are removed from local and `origin`.
