## Why

- Agents can interpret the completion contract as raw `git push` plus ad hoc PR operations, which triggers Codex policy approval prompts for publish steps even though Guardex already provides an approved finish flow.
- Completion guidance should make `gx branch finish ... --via-pr --wait-for-merge --cleanup` the explicit path so push, PR creation, merge wait, and cleanup happen under one repo-owned command.

## What Changes

- Update the managed AGENTS policy block and current repo AGENTS text to require the Guardex finish flow instead of standalone `git push` / `gh pr` commands.
- Update setup regression coverage so installed AGENTS guidance preserves this wording.

## Impact

- Affects agent-facing workflow guidance only; runtime finish behavior remains unchanged.
- Future `gx install` / `gx setup` managed-policy refreshes will keep agents on the Guardex finish path.
