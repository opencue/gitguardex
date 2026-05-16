## Why

- `gitguardex/frontend` is a standalone git repo, but `gx doctor --target gitguardex` only repaired the parent repo.
- When the frontend repo drifted, edits could still land on the frontend primary `main` checkout because its local Guardex files stayed missing.
- The user specifically wants frontend work to get its own guarded worktree + OpenSpec scaffold instead of writing directly on `main`.

## What Changes

- Make `gx doctor` recurse through nested git repos by default, using the same traversal surface as `gx setup`.
- Keep the existing single-repo doctor behavior behind `--single-repo` / `--no-recursive`.
- After a protected-branch sandbox doctor succeeds, sync the repaired managed Guardex files back into the protected base workspace so the local repo becomes guarded immediately.
- Add regression coverage for a parent repo plus a nested frontend repo on protected `main`.

## Impact

- Affected surface: `bin/multiagent-safety.js` doctor flow and `test/install.test.js`.
- Expected outcome: nested repos such as `frontend/` regain local Guardex files (`AGENTS.md`, agent scripts, hooks, lock state) after `gx doctor` runs from the parent repo.
- Risk: protected-main doctor now repairs more managed files in the local base workspace, so the sync path must stay limited to Guardex-managed surfaces.
