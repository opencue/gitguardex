# Proposal: restore auto-transfer stashes when branch start fails

`gx branch start` currently leaks `guardex-auto-transfer-*` stashes if startup fails after local changes are stashed off a protected branch. That leaves duplicate stash entries for paths like `memory-bank/` even though the branch never started. The safer behavior is to restore those changes back to the original checkout on failure and drop the temporary stash.

- add failure-safe auto-restore for temporary branch-start transfer stashes
- keep the success path unchanged when the new worktree is created and the stash applies cleanly
- lock the `memory-bank/` failure case with a focused regression
