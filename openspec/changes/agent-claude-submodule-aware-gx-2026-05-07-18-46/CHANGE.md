---
base_root_hash: missing-spec-root
slug: agent-claude-submodule-aware-gx-2026-05-07-18-46
---

# CHANGE · agent-claude-submodule-aware-gx-2026-05-07-18-46

## §P  proposal
# Submodule-aware gx role plan

## Problem

The existing OpenSpec plan workspace for submodule-aware gx has role tasks and prompt packets in-repo, but Colony had no published claimable plan, so helper agents could not claim planner, architect, executor, critic, writer, and verifier lanes from the coordination surface.

## Acceptance criteria

- Colony exposes claimable role subtasks for the existing submodule-aware gx plan.
- Each role subtask points to its plan prompt.md and tasks.md packet plus owned implementation files where applicable.
- Downstream agents claim files before edits and record verification or blockers in the role task handoff fields.

## Sub-tasks

### Sub-task 0: Planner: freeze submodule-aware gx plan

Use planner/prompt.md and planner/tasks.md to finish spec/open-question planning for the existing submodule-aware gx plan. Keep durable questions in the plan workspace and hand off execution boundaries.

File scope: openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/planner/tasks.md, openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/planner/prompt.md

### Sub-task 1: Architect: review lifecycle boundaries

Use architect/prompt.md and architect/tasks.md to validate submodule lifecycle boundaries, manifests, token preflight, and failure modes before implementation.

File scope: openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/architect/tasks.md, openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/architect/prompt.md

### Sub-task 2: Executor: implement submodule-aware gx (depends on: 0, 1)

Use executor/prompt.md and executor/tasks.md to add tests first, then implement submodule detection, lock tuple keying, start/finish wiring, and gx subcommands inside the approved scope.

File scope: openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/executor/tasks.md, openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/executor/prompt.md, scripts/agent-submodules.py, scripts/agent-branch-start.sh, scripts/agent-branch-finish.sh, scripts/agent-file-locks.py, scripts/codex-agent.sh, bin/gx, test/agent-submodules-detect.test.js, test/agent-submodules-locks.test.py, test/agent-submodules-finish.test.js, test/agent-submodules-preflight.test.js

### Sub-task 3: Quality review: stress-test executor diff (depends on: 2)

Use critic/prompt.md and critic/tasks.md to review executor output for unclaimed edits, stranded submodule writes, atomic gitlink bump correctness, and missing negative scenarios.

File scope: openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/critic/tasks.md, openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/critic/prompt.md

### Sub-task 4: Writer: sync operator docs/context (depends on: 2, 3)

Use writer/prompt.md and writer/tasks.md to update only approved user-facing workflow docs/context after implementation behavior is final.

File scope: openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/writer/tasks.md, openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/writer/prompt.md, AGENTS.md, README.md, openspec/specs/gitguardex-submodules/context.md

### Sub-task 5: Verifier: prove submodule-aware lifecycle (depends on: 3, 4)

Use verifier/prompt.md and verifier/tasks.md to run OpenSpec, focused node/python tests, and the approved walkthrough proof or record exact blockers.

File scope: openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/verifier/tasks.md, openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/verifier/prompt.md


## §S  delta
op|target|row
-|-|-

## §T  tasks
id|status|task|cites
-|-|-|-

## §B  bugs
id|status|task|cites
-|-|-|-
