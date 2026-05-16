## Why

- The Active Agents companion already shows live Guardex lanes, but every row is hardcoded to `thinking` even after the agent starts changing files in its sandbox.
- In multi-agent VS Code flows, users need to tell which worktree is still planning versus which one is actively moving without leaving Source Control.

## What Changes

- Derive per-session activity from the live sandbox worktree so clean lanes stay `thinking` while dirty lanes surface `working`.
- Update the Active Agents SCM rows and tooltips to include the live activity state, changed-file count, and changed-path preview.
- Add focused regression coverage for the activity inference and the rendered SCM row copy.

## Impact

- Affected surfaces: `templates/vscode/guardex-active-agents/extension.js`, `templates/vscode/guardex-active-agents/session-schema.js`, `test/vscode-active-agents-session-state.test.js`, and README/OpenSpec docs.
- Risk is narrow because the change stays read-only and derives activity from the existing live worktree instead of introducing a new runtime protocol.
- If git activity cannot be inspected for a live worktree, the companion must fall back to `thinking` instead of crashing or hiding the session row.
