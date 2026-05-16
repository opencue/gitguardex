## Why

- The Guardex Active Agents VS Code companion currently throws `this._dataProvider.getTreeItem is not a function` at render time.
- That crash keeps the Source Control view from showing live sandbox sessions even when `.omx/state/active-sessions/*.json` exists.

## What Changes

- Add the missing `getTreeItem` implementation to the Active Agents tree provider in the extension bundle this branch installs.
- Add focused regression coverage that activates the extension against a mocked VS Code host and asserts the provider satisfies the tree-data contract.

## Impact

- Affected surfaces: `templates/vscode/guardex-active-agents/extension.js`, `test/vscode-active-agents-session-state.test.js`, and this change workspace.
- Risk is narrow because the fix only restores the provider method VS Code already expects and the new test covers the exact failure mode.
