# Submodule-aware gx role plan

Plan slug: `agent-claude-submodule-aware-gx-2026-05-07-18-46`

## Problem

The existing OpenSpec plan workspace for submodule-aware gx has role tasks and prompt packets in-repo, but Colony had no published claimable plan, so helper agents could not claim planner, architect, executor, critic, writer, and verifier lanes from the coordination surface.

## Acceptance Criteria

- Colony exposes claimable role subtasks for the existing submodule-aware gx plan.
- Each role subtask points to its plan prompt.md and tasks.md packet plus owned implementation files where applicable.
- Downstream agents claim files before edits and record verification or blockers in the role task handoff fields.

## Roles

- [planner](./planner.md)
- [architect](./architect.md)
- [critic](./critic.md)
- [executor](./executor.md)
- [writer](./writer.md)
- [verifier](./verifier.md)

## Operator Flow

1. Refine this workspace until scope, risks, and tasks are explicit.
2. Publish the plan with `colony plan publish agent-claude-submodule-aware-gx-2026-05-07-18-46` or the `task_plan_publish` MCP tool.
3. Claim subtasks through Colony plan tools before editing files.
4. Close only when all subtasks are complete and `checkpoints.md` records final evidence.
