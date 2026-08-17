---
name: "source-command-opsx-checkpoint"
description: "Update plan role checkpoints in openspec/plan/<slug>/<role>/tasks.md"
---

# source-command-opsx-checkpoint

Use this skill when the user asks to run the migrated source command `opsx-checkpoint`.

## Command Template

Update a role checkpoint for an OpenSpec plan workspace.

**Input format**:

`/opsx:checkpoint <plan-slug> <role> <checkpoint-id> <state> <text...>`

Example:

```text
/opsx:checkpoint test-plan planner P2 in_progress refining options matrix
```

## Steps

1. Validate arguments:
   - `plan-slug` exists in `openspec/plan/`
   - `role` is one of: `planner`, `architect`, `critic`, `executor`, `writer`, `verifier`
   - `state` is one of: `ready`, `in_progress`, `blocked`, `failed`, `done`
2. Run:
   ```bash
   python3 scripts/openspec/update-plan-checkpoint.py \
     --plan <plan-slug> \
     --role <role> \
     --id <checkpoint-id> \
     --state <state> \
     --text "<text>"
   ```
3. Show updated checkpoint line from `<role>/tasks.md`.
4. Show latest line from `openspec/plan/<plan-slug>/checkpoints.md`.

## Guardrails

- Never rewrite unrelated checklist sections.
- Keep updates checkpoint-scoped and append-only in log file.
