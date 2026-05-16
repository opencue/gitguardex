# agent-codex-vscode-active-agents-icon-size-2026-04-22-16-50 (minimal / T1)

Branch: `agent/codex/vscode-active-agents-icon-size-2026-04-22-16-50`

Make the VS Code Active Agents extension icon read larger in the Extensions list/details pane. The current asset uses a wide wordmark composition with too much empty/low-signal space, so replace it with a tighter square bust crop derived from `logo.png`, mirror the asset into both shipped extension directories, and bump the extension manifest version so reinstalling can supersede the current base-branch build.

Scope:
- Regenerate `vscode/guardex-active-agents/icon.png` and `templates/vscode/guardex-active-agents/icon.png` from `logo.png` with a tighter square crop.
- Bump `vscode/guardex-active-agents/package.json` and `templates/vscode/guardex-active-agents/package.json` to `0.0.4`.
- Keep runtime/session code untouched.

Verification:
- `node --test test/vscode-active-agents-session-state.test.js`
- Manual visual check of the regenerated `icon.png` asset.

## Handoff

- Handoff: change=`agent-codex-vscode-active-agents-icon-size-2026-04-22-16-50`; branch=`agent/codex/vscode-active-agents-icon-size-2026-04-22-16-50`; scope=`vscode/guardex-active-agents/icon.png, templates/vscode/guardex-active-agents/icon.png, paired extension package.json files, T1 notes`; action=`tighten the icon crop, verify the mirrored assets stay aligned, then finish via PR merge + cleanup`.
- Copy prompt: Continue `agent-codex-vscode-active-agents-icon-size-2026-04-22-16-50` on branch `agent/codex/vscode-active-agents-icon-size-2026-04-22-16-50`. Work inside the existing sandbox, keep the bust-style icon larger than the current wordmark-heavy asset, and when verification is clean run `gx branch finish --branch agent/codex/vscode-active-agents-icon-size-2026-04-22-16-50 --base main --via-pr --wait-for-merge --cleanup`.

## Cleanup

- [x] Run: `gx branch finish --branch agent/codex/vscode-active-agents-icon-size-2026-04-22-16-50 --base main --via-pr --wait-for-merge --cleanup`
- [x] Record PR URL + `MERGED` state in the completion handoff.
- [x] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
