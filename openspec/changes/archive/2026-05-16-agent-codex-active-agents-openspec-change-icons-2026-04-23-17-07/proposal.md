## Why

- Active Agents now has bundled semantic icons for OpenSpec files, but unassigned changed rows can still fall back to the generic warning icon when the only extra signal is a delta label such as `Updated`.
- That makes `spec.md`, `proposal.md`, and `tasks.md` look visually identical in the tree right where operators want quick scan contrast.

## What Changes

- Keep semantic OpenSpec icons for unassigned delta-only rows so `proposal.md`, `tasks.md`, and `spec.md` stay visually distinct.
- Reserve the generic warning icon for real risk states only: protected-branch edits, foreign locks, or explicit lock warnings.
- Add focused regression coverage for delta-only unassigned OpenSpec changes.

## Impact

- Affected surfaces: `vscode/guardex-active-agents/extension.js`, `templates/vscode/guardex-active-agents/extension.js`, and `test/vscode-active-agents-session-state.test.js`.
- Risk stays narrow: icon-selection behavior only, with existing warning states preserved for real conflicts/locks.
