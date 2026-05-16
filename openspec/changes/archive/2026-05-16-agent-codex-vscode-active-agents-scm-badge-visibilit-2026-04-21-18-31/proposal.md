## Why

- The Active Agents SCM contribution can render session rows, but it cannot render the header count badge shown in the intended VS Code screenshot because it only registers a tree-data provider.
- The view also depends on prior user view-state persistence, so the section may stay hidden instead of appearing by default in Source Control.

## What Changes

- Create the SCM view with `createTreeView(...)` so the extension can set a live badge and empty-state message.
- Mark the contributed SCM view as visible by default.
- Add regression coverage for both the empty-state message and the live-session badge count.

## Impact

- Affected surfaces: `templates/vscode/guardex-active-agents/package.json`, `templates/vscode/guardex-active-agents/extension.js`, and `test/vscode-active-agents-session-state.test.js`.
- Risk is narrow because the change stays inside the VS Code companion and does not alter Guardex session-state generation.
