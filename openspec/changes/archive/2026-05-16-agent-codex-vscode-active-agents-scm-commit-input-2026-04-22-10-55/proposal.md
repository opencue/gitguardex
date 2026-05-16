## Why

- Operators can already see live Guardex sandboxes inside the `gitguardex.activeAgents` Source Control companion, but they cannot commit the selected sandbox without dropping back to the terminal.
- The reference UX already exposes a compact header commit affordance; this view should use the same pattern instead of forcing a second workflow.

## What Changes

- Track the currently selected Active Agents session in the VS Code companion.
- Add a native SCM commit input plus header commit command that targets the selected session's `worktreePath`.
- Stage with `git add -A` while excluding `.omx/state/agent-file-locks.json`, then run `git commit -m <message>` when the user accepts the input or clicks the header affordance.
- Show an information message if the user tries to commit without selecting a session first.

## Impact

- Scope stays inside the VS Code companion bundle plus its focused regression tests.
- The commit flow shells out to `git`, so failure paths must surface clear VS Code messages instead of failing silently.
