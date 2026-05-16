## Why

- `AGENTS.md` (which `CLAUDE.md` symlinks to) had grown to 786 lines and was loaded into every agent session, costing tokens on content that is only situationally relevant (full token-discipline rules, full Guardex toggle docs, full Claude Code workflow with tiering examples, full OpenSpec workflow, plan workspace contract, stalled-worktree recovery, multi-agent supplements).
- The marker-managed `multiagent-safety` block alone is ~430 lines and is machine-managed, so the editable contract dwarfs the readable signal at the top of the file.

## What Changes

- Trim the editable portion of `AGENTS.md` to an intro + Objective + ExecPlans pointer, a short "Quick rules" non-negotiables list, a "Workflow cheatsheet" with the canonical `gx` commands and tier table, Environment, Code Conventions, Source-of-Truth pointer, Versioning rule, and a link table of extracted subdocs.
- Move verbose sections verbatim into seven new subdocs under `.agent/`:
  - `.agent/TOKEN-DISCIPLINE.md` — Token-Efficient Execution + multi-agent Token/context budget supplement.
  - `.agent/GUARDEX-TOGGLE.md` — `GUARDEX_ON` semantics.
  - `.agent/CLAUDE-CODE-WORKFLOW.md` — full tiering, examples, default Claude finish, `skill_guard` notes.
  - `.agent/OPENSPEC-WORKFLOW.md` — OpenSpec-first workflow + documentation model + `/opsx:*` commands.
  - `.agent/MULTI-AGENT-CONTRACT.md` — repo-specific supplements to the marker contract.
  - `.agent/PLAN-WORKSPACE.md` — `openspec/plan/` workspace contract.
  - `.agent/STALLED-WORKTREE-RECOVERY.md` — `agent-stalled-report.sh` + `agent-autofinish-watch.sh` recovery.
- Preserve the marker-managed `multiagent-safety` block and the `SPECKIT` block byte-identical to `main`.
- Preserve the `CLAUDE.md -> AGENTS.md` symlink; only `AGENTS.md` is edited.

## Impact

- AGENTS.md drops from 786 → ~545 lines (editable portion ~110 lines; the rest is the untouched marker + SPECKIT blocks).
- Every rule moves verbatim; no semantic changes. The Quick rules + Workflow cheatsheet surface the non-negotiables that previously lived buried inside the Claude Code Workflow / Token-Efficient Execution sections.
- Subdocs are linked from a single table in `AGENTS.md`; agents that need the full context follow the link instead of paying the token cost up-front.
- No code paths or scripts change. `templates/AGENTS.multiagent-safety.md` is untouched.
