## Why

- Claude Code reports a non-blocking `PostToolUse` hook traceback after edits because the repo-local Python hook imports `datetime.UTC`, which is unavailable under Python 3.10.
- The hook should run cleanly on the Python versions commonly exposed as `python3` in agent shells.

## What Changes

- Replace `datetime.UTC` with `datetime.timezone.utc` in the Claude and Codex edit-tracker hook copies.
- Add focused regression coverage that executes the Claude `PostToolUse` edit tracker through system `python3`.

## Impact

- Affects only local agent hook bookkeeping for edited files.
- No runtime package behavior changes outside hook compatibility.
