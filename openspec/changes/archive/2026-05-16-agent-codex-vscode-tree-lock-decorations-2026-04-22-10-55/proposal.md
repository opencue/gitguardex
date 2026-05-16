## Why

- The Active Agents companion already distinguishes `working` from `thinking`, but long-idle clean sessions still blend into the same neutral styling.
- VS Code tree-item decorations need a stable `resourceUri`, so session rows need a synthetic URI that stays tied to the branch identity instead of a real file path.

## What Changes

- Add a `vscode.FileDecorationProvider` for synthetic `gitguardex-agent://<sanitized-branch>` session URIs.
- Set `SessionItem.resourceUri` from the session branch so idle clean lanes can be decorated without affecting changed-file rows.
- Surface idle thresholds for clean sessions: yellow after 10 minutes, red after 30 minutes, while leaving `working` lanes on their existing styling.
- Fire decoration refreshes whenever the Active Agents tree refreshes so elapsed-idle styling stays current.

## Impact

- Highlights stale clean lanes in the Source Control companion without altering working-session emphasis.
- Keeps decoration behavior branch-stable across reloads and session refreshes.
