# Tasks

| # | Status | Title | Files | Depends on | Capability | Spec row | Owner |
| - | - | - | - | - | - | - | - |
0|available|Planner: freeze submodule-aware gx plan|`openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/planner/tasks.md`<br>`openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/planner/prompt.md`|-|doc_work|-|-
1|available|Architect: review lifecycle boundaries|`openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/architect/tasks.md`<br>`openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/architect/prompt.md`|-|infra_work|-|-
2|available|Executor: implement submodule-aware gx|`openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/executor/tasks.md`<br>`openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/executor/prompt.md`<br>`scripts/agent-submodules.py`<br>`scripts/agent-branch-start.sh`<br>`scripts/agent-branch-finish.sh`<br>`scripts/agent-file-locks.py`<br>`scripts/codex-agent.sh`<br>`bin/gx`<br>`test/agent-submodules-detect.test.js`<br>`test/agent-submodules-locks.test.py`<br>`test/agent-submodules-finish.test.js`<br>`test/agent-submodules-preflight.test.js`|0, 1|infra_work|-|-
3|available|Quality review: stress-test executor diff|`openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/critic/tasks.md`<br>`openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/critic/prompt.md`|2|infra_work|-|-
4|available|Writer: sync operator docs/context|`openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/writer/tasks.md`<br>`openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/writer/prompt.md`<br>`AGENTS.md`<br>`README.md`<br>`openspec/specs/gitguardex-submodules/context.md`|2, 3|doc_work|-|-
5|available|Verifier: prove submodule-aware lifecycle|`openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/verifier/tasks.md`<br>`openspec/plan/agent-claude-submodule-aware-gx-2026-05-07-18-46/verifier/prompt.md`|3, 4|test_work|-|-
