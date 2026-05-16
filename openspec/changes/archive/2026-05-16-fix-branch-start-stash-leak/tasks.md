## 1. Spec

- [x] 1.1 Capture why failed branch-start attempts must restore temporary auto-transfer stashes instead of leaking them.

## 2. Implementation

- [x] 2.1 Update `templates/scripts/agent-branch-start.sh` and `scripts/agent-branch-start.sh` with failure-safe auto-restore.
- [x] 2.2 Add a focused regression in `test/branch.test.js` for the `memory-bank/` failure path.

## 3. Verification

- [x] 3.1 Run targeted Guardex branch tests.
- [x] 3.2 Run script parity/diff hygiene.
- [x] 3.3 Run `openspec validate --specs`.

Verification evidence:
- `node --test test/branch.test.js` (pass)
- `node --test test/metadata.test.js` (pass)
- `bash -n scripts/agent-branch-start.sh` and `bash -n templates/scripts/agent-branch-start.sh` (pass)
- `git diff --check` (pass)
- `openspec validate --specs` (no items found to validate)

## 4. Cleanup

- [x] 4.1 Commit, push, open/update PR, merge, and clean up the worktree.
