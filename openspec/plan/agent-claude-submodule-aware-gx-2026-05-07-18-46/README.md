# Plan Workspace: agent-claude-submodule-aware-gx-2026-05-07-18-46

Durable pre-implementation planning workspace.

Use this command to update checkpoints:

```bash
/opsx:checkpoint agent-claude-submodule-aware-gx-2026-05-07-18-46 <role> <checkpoint-id> <state> <note...>
```

Roles (each has its own `tasks.md` and copyable `prompt.md`):

- `planner/` — owns spec + open-questions
- `architect/` — owns manifest schema + failure catalog
- `critic/` — stress-tests design + executor diff
- `executor/` — implements (tests first, then code)
- `writer/` — keeps AGENTS.md, README, and context.md in sync
- `verifier/` — proves the change works against this repo before archive

See `summary.md` for the high-level intent and `open-questions.md`
for unresolved tradeoffs.
