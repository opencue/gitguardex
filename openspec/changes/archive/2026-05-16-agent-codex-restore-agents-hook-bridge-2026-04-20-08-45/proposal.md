## Why

- Claude/Codex hooks are configured to execute under `.agents/hooks/*`.
- This repository ships hook implementations under `.codex/hooks` and `.claude/hooks`, but `.agents/` can be missing.
- When `.agents/` is absent, `UserPromptSubmit` fails with `[Errno 2] No such file or directory` and blocks Claude prompt submission.

## What Changes

- Add a repository-root compatibility alias `.agents -> .codex`.
- Keep existing hook settings unchanged so both Claude and Codex continue to resolve the same path contract.
- Verify `skill_activation.py` and `skill_guard.py` execute successfully via the `.agents/hooks` path.

## Impact

- Affected surface is limited to hook path resolution in local agent sessions.
- No runtime package behavior changes, no dependency changes.
- Low risk: symlink is reversible and only routes existing files.
