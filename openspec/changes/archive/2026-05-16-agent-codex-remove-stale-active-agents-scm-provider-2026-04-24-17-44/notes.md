# Remove stale Active Agents SCM providers

## Intent

Prevent old locally installed `recodeee.gitguardex-active-agents*` companion copies from continuing to register the removed `Active Agents Commit` Source Control providers.

## Scope

- Update the VS Code companion installer to delete retired extension IDs before installing the current `Recodee.gitguardex-active-agents` copy.
- Keep `scripts/` and `templates/scripts/` installer copies in sync.
- Extend the focused Active Agents extension test to cover retired install cleanup.

## Verification

- Passed: `node --test test/vscode-active-agents-session-state.test.js` (`55/55`).
- Passed: `node scripts/install-vscode-active-agents-extension.js` removed 20 retired lowercase local install paths.
- Passed: no remaining `recodeee.gitguardex-active-agents*` folders under `/home/deadpool/.vscode/extensions`.
- Passed: no `createSourceControl` or `Active Agents Commit` matches in current installed `Recodee.gitguardex-active-agents` copies checked.
- Baseline red: `node --test test/metadata.test.js` still fails unrelated README release-note/version expectations and pre-existing `vscode/guardex-active-agents/extension.js` template drift.
