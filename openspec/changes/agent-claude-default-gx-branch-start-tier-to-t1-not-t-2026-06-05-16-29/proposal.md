## Why

`gx branch start` defaulted to tier T3 (full change + plan workspace, ~7290
tokens of scaffolding) when `--tier` was omitted. Most tasks are small (a fix, a
tweak) and never touch the plan workspace, so every default branch-start paid
thousands of tokens an agent immediately ignores. The audit ranked flipping this
default the highest-leverage scaffold fix.

## What Changes

- Default tier flips from T3 to **T1** (notes.md only) in
  `templates/scripts/agent-branch-start.sh` (`GUARDEX_OPENSPEC_TIER` default and
  the `normalize_tier` fallback).
- `gx branch start` prints an escalation hint on T1: use `--tier T2` for a
  behavior change, `--tier T3` for plan-driven work.
- Usage text + the tier-guide docs (`AGENTS.md`, `.agent/CLAUDE-CODE-WORKFLOW.md`)
  updated to state the new default.

## Impact

- **Affected**: `templates/scripts/agent-branch-start.sh` (symlinked from
  `scripts/`), `AGENTS.md`, `.agent/CLAUDE-CODE-WORKFLOW.md`.
- **Behavior**: omitting `--tier` now yields the minimal scaffold; behavior
  changes must opt up with `--tier T2/T3` (the hint + docs guide this). Explicit
  `--tier` and `GUARDEX_OPENSPEC_TIER` are unaffected.
- **Follow-up (not in this change)**: auto-escalation when an agent writes
  proposal.md/spec.md into a T1 change — needs a separate runtime hook.
- Verified by `test/branch.test.js` ("DEFAULTS to T1 ... when --tier is omitted").
