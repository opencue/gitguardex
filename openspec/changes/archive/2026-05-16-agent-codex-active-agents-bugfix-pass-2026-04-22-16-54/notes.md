# agent-codex-active-agents-bugfix-pass-2026-04-22-16-54 (minimal / T1)

Branch: `agent/codex/active-agents-bugfix-pass-2026-04-22-16-54`

Patch the shipped VS Code `Active Agents` companion bugs that remain after the grouped-session rollout. Keep the scope on the real defects: duplicate provider methods, expensive clean-worktree activity scans, stop-session process handling, and blocking diff rendering.

Scope:
- Update `vscode/guardex-active-agents/session-schema.js` to bound and cache clean-worktree activity checks.
- Update `vscode/guardex-active-agents/extension.js` to remove the duplicate lock-registry methods, route stop through `gx`, replace the blocking diff dump with Git-native change opens, and drop the emoji lock label.
- Update the focused extension/CLI regressions so they cover the live `vscode/` source instead of the stale template copy, then add metadata parity coverage so the mirrored JS sources do not drift again.

Verification:
- `node --test test/vscode-active-agents-session-state.test.js test/agents.test.js`
- `node --test test/metadata.test.js`

## Handoff

- Handoff: change=`agent-codex-active-agents-bugfix-pass-2026-04-22-16-54`; branch=`agent/codex/active-agents-bugfix-pass-2026-04-22-16-54`; scope=`vscode/guardex-active-agents/*, src/cli/{args.js,main.js}, test/{vscode-active-agents-session-state.test.js,agents.test.js}, openspec/changes/agent-codex-active-agents-bugfix-pass-2026-04-22-16-54/notes.md`; action=`fix the remaining Active Agents extension bugs, verify with targeted Node tests, then finish via PR merge + cleanup`.
- Copy prompt: Continue `agent-codex-active-agents-bugfix-pass-2026-04-22-16-54` on branch `agent/codex/active-agents-bugfix-pass-2026-04-22-16-54`. Work inside the existing sandbox, review `openspec/changes/agent-codex-active-agents-bugfix-pass-2026-04-22-16-54/notes.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/codex/active-agents-bugfix-pass-2026-04-22-16-54 --base main --via-pr --wait-for-merge --cleanup`.

## Cleanup

- [x] Run: `gx branch finish --branch agent/codex/active-agents-bugfix-pass-2026-04-22-16-54 --base main --via-pr --wait-for-merge --cleanup`
- [x] Record PR URL + `MERGED` state in the completion handoff.
- [x] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
