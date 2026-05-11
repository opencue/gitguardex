# Tasks

## 1. Spec

- [x] 1.1 Capture problem + approach in `proposal.md`.
- [x] 1.2 Add ADDED requirements + scenarios to `specs/gitguardex-agent-lifecycle/spec.md`.

## 2. Symlink conversion

- [x] 2.1 Replace `scripts/agent-branch-start.sh` with symlink to `../templates/scripts/agent-branch-start.sh`.
- [x] 2.2 Replace `scripts/agent-branch-finish.sh` with symlink to `../templates/scripts/agent-branch-finish.sh`.
- [x] 2.3 Replace `scripts/agent-branch-merge.sh` with symlink to `../templates/scripts/agent-branch-merge.sh`.
- [x] 2.4 Replace `scripts/agent-file-locks.py` with symlink to `../templates/scripts/agent-file-locks.py`.
- [x] 2.5 Replace `scripts/agent-worktree-prune.sh` with symlink to `../templates/scripts/agent-worktree-prune.sh`.
- [x] 2.6 Replace `scripts/codex-agent.sh` with symlink to `../templates/scripts/codex-agent.sh`.
- [x] 2.7 Replace `scripts/install-agent-git-hooks.sh` with symlink to `../templates/scripts/install-agent-git-hooks.sh`.
- [x] 2.8 Replace `scripts/review-bot-watch.sh` with symlink to `../templates/scripts/review-bot-watch.sh`.
- [x] 2.9 Replace `scripts/openspec/init-change-workspace.sh` with symlink to `../../templates/scripts/openspec/init-change-workspace.sh`.
- [x] 2.10 Replace `scripts/openspec/init-plan-workspace.sh` with symlink to `../../templates/scripts/openspec/init-plan-workspace.sh`.

## 3. Parity guard

- [x] 3.1 Add `scripts/check-script-symlinks.sh` verifier (executable, exits non-zero on drift with fix-hint output).
- [x] 3.2 Wire the verifier into `.github/workflows/ci.yml` as a step in the test job.

## 4. Verification

- [x] 4.1 Smoke `bash scripts/agent-branch-finish.sh --auto-resolve=full --branch x` through the symlink — arg parser shows new flag (proof the runtime version is reached).
- [x] 4.2 Smoke `bash scripts/agent-branch-start.sh --no-transfer --tier T0` through the symlink — flag is accepted (proof the post-PR-547 runtime version is reached).
- [x] 4.3 `python3 scripts/agent-file-locks.py status --help` through the symlink — Python follows symlink transparently.
- [x] 4.4 `bash scripts/check-script-symlinks.sh` returns 0 in the new state.

## 5. Cleanup

- [ ] 5.1 Commit on `agent/claude/canonicalize-templates-scripts-2026-05-11-11-06`.
- [ ] 5.2 Push and open PR against `main`.
- [ ] 5.3 PR merged (record URL + MERGED state).
- [ ] 5.4 Sandbox worktree pruned via `gx branch finish --cleanup`.
