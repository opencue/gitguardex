## Why

- Repeated Active Agents follow-ups still require editing two identical source trees:
  `vscode/guardex-active-agents/` and
  `templates/vscode/guardex-active-agents/`.
- The repo's current install/runtime/test surfaces already treat
  `vscode/guardex-active-agents/` as the primary bundle and the template tree
  as a fallback/parity surface, so the duplicate editing cost is structural
  rather than functional.
- We need one canonical source of truth for the VS Code companion so future
  runtime, inspect, icon, and docs changes stop creating mirror-only cleanup
  work.

## What Changes

- Make `vscode/guardex-active-agents/` the canonical editable source for the
  Active Agents extension bundle.
- Keep `templates/vscode/guardex-active-agents/` as the managed distribution
  copy, but refresh it from the canonical source through an explicit
  repo-managed sync/repair path instead of manual dual edits.
- Update the install/runtime/test/docs contract to reflect the canonical-source
  model without changing the user-visible behavior of the extension.
- Expand parity protection so the manifest, README, icon, and runtime files
  stay aligned, not just `extension.js` and `session-schema.js`.

## Impact

- Affected surfaces:
  `vscode/guardex-active-agents/*`,
  `templates/vscode/guardex-active-agents/*`,
  `scripts/install-vscode-active-agents-extension.js`,
  `scripts/agent-session-state.js`,
  `test/vscode-active-agents-session-state.test.js`,
  `test/metadata.test.js`,
  and README/install guidance.
- Risk is moderate because setup/install/template consumers can drift if the
  sync path is incomplete, but the operator-visible extension behavior should
  remain unchanged.
- Rollout should stay focused: land the canonical-source plumbing, prove
  session/install behavior with focused tests, then finish the lane through the
  normal Guardex PR and cleanup flow.
