## Why

The VS Code Active Agents companion already shows per-row `working` versus `thinking`, but the busy lanes still blend into one flat `ACTIVE AGENTS` list. When several sandboxes are live, the user has to inspect each row one by one to find the branches actively editing files.

## What Changes

- Split the `ACTIVE AGENTS` tree into visible `WORKING NOW` and `THINKING` subgroups.
- Surface a repo-level working count in the repo summary row and the SCM badge tooltip.
- Use a distinct VS Code codicon for actively working lanes so they stand out from thinking-only sessions.
- Update README/test coverage to lock the new grouping and summary behavior.

## Impact

- Affected surfaces: `templates/vscode/guardex-active-agents/extension.js`, `templates/vscode/guardex-active-agents/README.md`, `test/vscode-active-agents-session-state.test.js`, and the root `README.md`.
- No runtime/session-file schema changes; the companion still reads the existing `.omx/state/active-sessions/*.json` records.
