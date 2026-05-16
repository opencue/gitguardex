## Why

- `gx branch finish` can push a parent branch that updates a submodule gitlink before the submodule branch containing that commit is on its remote.
- That strands the parent branch/PR with a gitlink that collaborators and CI cannot fetch, and it causes agents to ask for separate ad hoc `git push` approval outside the Guardex finish flow.

## What Changes

- During `gx branch finish`, changed submodule gitlinks are detected before the parent branch is pushed or merged.
- For each changed checked-out submodule, Guardex pushes the local branch containing the gitlink commit to that submodule's configured remote.
- If the submodule commit cannot be safely pushed, finish fails before pushing the parent branch.

## Impact

- Affects `scripts/agent-branch-finish.sh` PR and direct push flows.
- Keeps network approval consolidated around the single `gx branch finish` invocation.
- Does not bypass host approval policy; it only moves the required submodule push into the existing finish command.
