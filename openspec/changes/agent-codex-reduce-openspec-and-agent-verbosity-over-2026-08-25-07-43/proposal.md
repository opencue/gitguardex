## Why

- Routine GitGuardex work currently creates and repeatedly updates OpenSpec
  artifacts even when the user only wants implementation. Existing full
  managed AGENTS blocks also remain sticky across normal setup refreshes,
  keeping a large instruction payload in every agent turn.

## What Changes

- Make T1 the direct-execution tier with no OpenSpec scaffold.
- Keep structured OpenSpec workspaces available through explicit T2/T3 use.
- Make the full AGENTS contract explicitly opt-in on every setup refresh;
  normal setup installs or restores the minimal contract.
- Tell full-contract agents that OpenSpec is opt-in and routine progress belongs
  in code, tests, and a concise final handoff rather than artifact churn.

## Impact

- Default branch creation writes fewer files and requires less agent narration.
- Repositories that want the full contract must run `gx setup --contract`.
- Explicit T2/T3 OpenSpec behavior remains available and tested.
