## Why

The repo still brands the primary user-facing surfaces as `guardex` even though the working repo/product name is now `gitguardex`. The fixed startup context is also paying for verbose skill/command/template copy that can be shorter without losing the workflow.

## What Changes

1. Rename the primary CLI/skill/command surfaces from `guardex` to `gitguardex` while keeping `gx` and the legacy `guardex` bin alias working.
2. Install `gitguardex` skill/command templates into consumer repos instead of the old `guardex` paths.
3. Compress the always-loaded AGENTS marker block, Codex skill, and Claude command so fixed context drops materially.

## Impact

- User-facing logs/help point at `gitguardex`.
- Consumer repos get `.codex/skills/gitguardex/SKILL.md` and `.claude/commands/gitguardex.md`.
- Fixed launch context shrinks because the installed skill/command/template text is shorter.
