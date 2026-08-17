---
name: "source-command-opsx-watch-plan"
description: "Watch OMX team task state and mirror checkpoints into openspec/plan role tasks files"
---

# source-command-opsx-watch-plan

Use this skill when the user asks to run the migrated source command `opsx-watch-plan`.

## Command Template

Watch a running OMX team and mirror task status into OpenSpec plan checkpoints.

**Input format**:

`/opsx:watch-plan <team-name> <plan-slug>`

Example:

```text
/opsx:watch-plan team-runtime-ready-badge omx-dashboard-badge-plan
```

## Steps

1. Verify team runtime state exists at `.omx/state/team/<team-name>/tasks/`.
2. Verify plan workspace exists at `openspec/plan/<plan-slug>/`.
3. Start watcher:

   ```bash
   python3 scripts/openspec/sync-team-plan-checkpoints.py \
     --team <team-name> \
     --plan <plan-slug>
   ```

4. Keep running until user stops it (Ctrl+C).

## Output

- Print sync updates as they occur.
- Role `tasks.md` checkpoint sections and `openspec/plan/<plan-slug>/checkpoints.md` become the visible checkpoint board.

## Guardrails

- Do not mutate non-checkpoint sections.
- If team state is missing, fail fast with a clear message.
