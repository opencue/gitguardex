# agent-codex-vscode-active-agents-welcome-view-2026-04-22-10-58 (minimal / T1)

Branch: `agent/codex/vscode-active-agents-welcome-view-2026-04-22-10-58`

Replace the Active Agents empty-state placeholder with a native VS Code welcome view that exposes direct actions for starting a sandbox, opening the guide, and refreshing the panel.

Scope:
- Add `contributes.viewsWelcome` plus a `gitguardex.activeAgents.startAgent` command in both extension manifests.
- Remove the `InfoItem` empty-state fallback so the tree returns empty and VS Code renders the welcome content.
- Prompt for task + agent name, then send `gx branch start '<task>' '<agent>'` to an integrated terminal.
- Add a stable `README.md#quick-start` anchor for the guide link.
- Extend the active-agents regression suite to cover the new empty-state and command flow.

Verification:
- `node --test test/vscode-active-agents-session-state.test.js`

## Handoff

- Handoff: change=`agent-codex-vscode-active-agents-welcome-view-2026-04-22-10-58`; branch=`agent/codex/vscode-active-agents-welcome-view-2026-04-22-10-58`; scope=`templates/vscode/guardex-active-agents/*, vscode/guardex-active-agents/*, test/vscode-active-agents-session-state.test.js, openspec/changes/agent-codex-vscode-active-agents-welcome-view-2026-04-22-10-58/*`; action=`finish this sandbox via PR merge + cleanup after targeted verification`.
- Copy prompt: Continue `agent-codex-vscode-active-agents-welcome-view-2026-04-22-10-58` on branch `agent/codex/vscode-active-agents-welcome-view-2026-04-22-10-58`. Work inside the existing sandbox, review `openspec/changes/agent-codex-vscode-active-agents-welcome-view-2026-04-22-10-58/notes.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/codex/vscode-active-agents-welcome-view-2026-04-22-10-58 --base main --via-pr --wait-for-merge --cleanup`.

## Cleanup

- [x] Run: `gx branch finish --branch agent/codex/vscode-active-agents-welcome-view-2026-04-22-10-58 --base main --via-pr --wait-for-merge --cleanup`
- [x] Record PR URL + `MERGED` state in the completion handoff.
- [x] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
