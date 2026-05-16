## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## 1. Specification

- [x] 1.1 Finalize the scope around bumping the VS Code extension version whenever shipped plugin files change, activating the companion on VS Code startup, and auto-installing newer workspace builds.
- [x] 1.2 Define the normative version + startup + auto-update requirements in `specs/vscode-active-agents-extension/spec.md`.

## 2. Implementation

- [x] 2.1 Bump the live/template Active Agents extension manifests from `0.0.1` to `0.0.3`.
- [x] 2.2 Make the extension install regression read the current manifest version instead of hardcoding `0.0.1`.
- [x] 2.3 Add a focused regression that fails when extension-shipping files change without a higher version than the base branch.
- [x] 2.4 Add `onStartupFinished` to the live/template manifests and lock the installed-manifest/startup contract in the focused regression suite.
- [x] 2.5 Auto-install a newer workspace companion build on activate and offer a `Reload Window` action after the update lands.

## 3. Verification

- [x] 3.1 Run `node --test test/vscode-active-agents-session-state.test.js`.
- [x] 3.2 Run `openspec validate agent-codex-vscode-extension-version-bump-guard-2026-04-22-16-18 --type change --strict`.
- [x] 3.3 Run `openspec validate --specs`.

## 4. Cleanup (mandatory; run before claiming completion)

- [x] 4.1 Run `gx branch finish --branch agent/codex/always-active-vscode-extension-2026-04-22-16-18 --base main --via-pr --wait-for-merge --cleanup`; the guarded finish merged PR `#327` and needed one manual cleanup pass after the live `/tmp` worktree blocked local branch deletion.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff: `https://github.com/recodeee/gitguardex/pull/327` (`MERGED`, merged at `2026-04-22T14:55:22Z`).
- [x] 4.3 Confirm the sandbox worktree is gone and the branch refs are gone: `git worktree list` no longer shows `/tmp/gitguardex-agent__codex__always-active-vscode-extension-2026-04-22-16-18`, and `git fetch --prune origin` removed the last stale `origin/agent/codex/always-active-vscode-extension-2026-04-22-16-18` tracking ref after local branch deletion.
