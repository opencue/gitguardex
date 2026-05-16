## Why

- The shipped VS Code companion only renders a flat `Active Agents` list, so it cannot resemble the grouped Source Control layout operators expect from the real Guardex workflow.
- Users need the companion to show active lanes in repo context, with nearby repo changes visible in the same SCM-side tree instead of forcing a separate mental model.

## What Changes

- Reshape the SCM-container tree so each repo renders as a top-level node with grouped `ACTIVE AGENTS` and `CHANGES` sections.
- Keep the existing live-agent activity copy (`thinking` / `working`, changed-file counts, elapsed time), while also deriving repo-root git changes for the new `CHANGES` group.
- Add focused regression coverage for the new grouped tree structure and update the extension/readme copy to describe the repo-context view.

## Impact

- Affected surfaces: `templates/vscode/guardex-active-agents/extension.js`, `templates/vscode/guardex-active-agents/session-schema.js`, `templates/vscode/guardex-active-agents/README.md`, `test/vscode-active-agents-session-state.test.js`, and the root `README.md`.
- Risk is narrow because the change remains read-only; it only changes how repo/session state is presented in the VS Code companion.
- If repo git state cannot be inspected, the extension should keep showing active agents and simply omit repo-change rows instead of failing the whole view.
