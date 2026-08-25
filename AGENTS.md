# AGENTS

This document is the agent contract for this repo. It applies identically to Codex, Claude Code, and any other agentic CLI working here. `CLAUDE.md` is a symlink to this file — do not edit them independently.

## Objective

- Optimize for task completion with low token use.
- Prefer phase-based execution over conversational micro-steps.

## Claude Code quickstart

If you are a Claude Code session arriving in this repo for the first time:

1. **Branch awareness** — by default ANY branch that is not a protected base
   (`main`/`dev`/`master`, plus any repo-configured protected branch) counts as
   an agent-managed branch you may edit and commit on. `agent/*`, `claude/*`,
   `vendor/*`, `feat/*`, or any ad-hoc name all work — being OFF a protected
   base is the only load-bearing rule, so you don't need to set
   `GUARDEX_AGENT_BRANCH_PREFIXES`. Lockdown is opt-in: set
   `GUARDEX_AGENT_BRANCH_PREFIXES_ONLY=1` (+ an explicit prefix list) to gate
   the Claude Code edit/Bash guard, and/or `GUARDEX_REQUIRE_AGENT_BRANCH=1`
   (or `git config multiagent.requireAgentBranch true`) to force git commits
   back onto the `agent/*` namespace.
2. **Slash commands** — `/gx-status`, `/gx-doctor`, `/gx-pivot`,
   `/gx-pr`, `/gx-finish`, `/gx-setup`, `/gx-act` are available out of the
   box. See `.claude/commands/`. `/gx-act` wraps
   [nektos/act](https://github.com/nektos/act) so CI workflows run locally
   before the remote PR run, letting you squash-merge on the first green
   round-trip.
3. **PR flow** — when you need explicit PR control, use `gx pr open`,
   `gx pr status`, `gx pr sync`, or `gx pr watch`. For end-of-task
   commit + push + PR + merge + cleanup, still use the non-negotiable
   `gx branch finish --via-pr --wait-for-merge --cleanup`.
4. **Repo wiring** — `gx claude install` writes `.claude/settings.json`,
   hooks, slash commands, the gitguardex skill, and a `.mcp.json` that registers
   the read-only `gx` MCP server (the cross-repo agent radar: `list_agents`,
   `who_owns`, `my_context`) into a target repo. Opt out with `--no-mcp`.
   `gx claude check` diagnoses drift without writing; `gx claude doctor`
   diagnoses and repairs.

## ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in `.agent/PLANS.md`) from design to implementation.

## Quick rules (non-negotiables)

- Never edit, stage, or commit on `dev` / `main`. Open an `agent/*` branch + worktree first.
- Claim files before edits: `gx locks claim --branch "<agent-branch>" <file...>` (or Colony `task_claim_file` on an active task).
- Finish completed work with `gx branch finish --branch "<agent-branch>" --via-pr --wait-for-merge --cleanup`. Never stop at bare `--via-pr`. `gx ship` is the short alias for that exact gated finish.
- When work is complete, always offer to finish and merge it — never leave commits stranded in a worktree. Set `GUARDEX_AUTO_SHIP=1` to make a bare `gx finish` / `gx branch finish` default to that gated ship automatically (see Toggle).
- Commit, push, and open/update a PR for completed work unless the user explicitly says to keep it local.
- OpenSpec is opt-in. Work directly in code/tests unless the user requests it, an existing change is being continued, or T2/T3 is explicitly selected.
- Keep outputs compact: less word, same proof.
- Do not commit ephemeral runtime artifacts or local settings: `.dev-ports.json`, `apps/logs/*.log`, `.codex/settings.local.json`, `.claude/settings.local.json`, `.omc/project-memory.json`, `.omc/state/**`, `.omx/state/**`.
- Do not embed stale memory dumps, PR transcripts, session history, or long logs in this file.
- Frontend/UI/UX requests: load `.codex/skills/ui-ux-pro-max/SKILL.md` first.
- The `multiagent-safety` marker section below is machine-managed. Do not edit between markers.

## Workflow cheatsheet

```bash
# 1. Start a sandbox worktree (default T1 writes no OpenSpec artifacts):
ALLOW_BASH_ON_NON_AGENT_BRANCH=1 \
  gx branch start [--tier T0|T1|T2|T3] "<task>" "claude-<name>"

# 2. Work inside the printed worktree path:
cd .omc/agent-worktrees/gitguardex__claude-<name>__<slug>
gx locks claim --branch "agent/claude-<name>/<slug>" <file...>
# implement + commit inside this worktree

# 3. Only for an explicitly active OpenSpec workflow:
openspec validate --specs

# 4. Finish via PR + cleanup (the non-negotiable default):
gx branch finish \
  --branch "agent/claude-<name>/<slug>" \
  --base main --via-pr --wait-for-merge --cleanup

# Branch protection blocks merge? Enable auto-merge once PR URL is known:
gh pr merge <PR-NUMBER> --repo <owner>/<repo> --auto --squash

# Sweep multiple finished lanes in one shot:
gx finish --all
```

Tier guide (**default is direct T1**; select T2/T3 only when OpenSpec is wanted):

| Tier | Use for | Scaffolding | Gates |
|------|---------|-------------|-------|
| `T0` | typos, dep bumps, format-only | none | tasks gate skipped |
| `T1` | routine implementation (default) | none | tasks gate skipped |
| `T2` | explicit structured change | full change workspace | full gates |
| `T3` | explicit plan-driven work | change + plan workspace | full gates |

See [`.agent/CLAUDE-CODE-WORKFLOW.md`](.agent/CLAUDE-CODE-WORKFLOW.md) for full tier examples, finish flow, and `skill_guard` notes.

## Environment

- Python: `.venv/bin/python` (uv, CPython 3.13.3)
- GitHub auth for git/API is available via env vars: `GITHUB_USER`, `GITHUB_TOKEN` (PAT). Do not hardcode or commit tokens.
- For authenticated git over HTTPS in automation, use: `https://x-access-token:${GITHUB_TOKEN}@github.com/<owner>/<repo>.git`

## Code Conventions

The `/project-conventions` skill is auto-activated on code edits (PreToolUse guard).

| Convention              | Location                              | When                         |
| ----------------------- | ------------------------------------- | ---------------------------- |
| Code Conventions (Full) | `/project-conventions` skill          | On code edit (auto-enforced) |
| Git Workflow            | `.codex/conventions/git-workflow.md` | Commit / PR                  |

## Source of Truth (OpenSpec, when explicitly active)

- **Specs/Design/Tasks (SSOT)**: `openspec/`
  - Active changes: `openspec/changes/<change>/`
  - Main specs: `openspec/specs/<capability>/spec.md`
  - Archived changes: `openspec/changes/archive/YYYY-MM-DD-<change>/`
- `spec.md` is normative (testable requirements only); free-form context lives in `openspec/specs/<capability>/context.md`.
- Do not add feature/behavior docs under `docs/`. Do not edit `CHANGELOG.md` directly.
- Validate: `openspec validate --specs`. Verify before archive: `/opsx:verify <change>`.
- Opt-in OpenSpec workflow, command list, and documentation model: [`.agent/OPENSPEC-WORKFLOW.md`](.agent/OPENSPEC-WORKFLOW.md).

## Versioning Rule

If a change publishes or bumps a package version, the same change must also update the release notes / changelog entries (record change notes in OpenSpec artifacts, not `CHANGELOG.md`).

## Extracted contracts (subdocs)

| Subdoc | What's inside |
|---|---|
| [`.agent/TOKEN-DISCIPLINE.md`](.agent/TOKEN-DISCIPLINE.md) | Token-efficient execution: planning phases, token/command/git discipline, reporting format, verification, and multi-agent token budget supplement. |
| [`.agent/MULTI-AGENT-EFFICIENCY.md`](.agent/MULTI-AGENT-EFFICIENCY.md) | Token-efficient multi-agent work: scout-then-implement, one-job-per-agent, parallel split-role review, model routing, and when not to fan out. |
| [`.agent/GUARDEX-TOGGLE.md`](.agent/GUARDEX-TOGGLE.md) | `GUARDEX_ON` toggle semantics in repo-root `.env` (disable / re-enable Guardex workflow). |
| [`.agent/CLAUDE-CODE-WORKFLOW.md`](.agent/CLAUDE-CODE-WORKFLOW.md) | Full Claude Code workflow: tiering table with examples, sandbox + lock + finish steps, default Claude finish (non-negotiable), `skill_guard` notes. |
| [`.agent/OPENSPEC-WORKFLOW.md`](.agent/OPENSPEC-WORKFLOW.md) | Opt-in OpenSpec workflow, source-of-truth layout, documentation model (spec + context), and `/opsx:*` command list. |
| [`.agent/MULTI-AGENT-CONTRACT.md`](.agent/MULTI-AGENT-CONTRACT.md) | Repo-specific supplements to the marker-managed multiagent-safety contract: local base safety, ownership/lock discipline (incl. `main.rs` lock), shared behavior protection, integrator finalization gate. |
| [`.agent/PLAN-WORKSPACE.md`](.agent/PLAN-WORKSPACE.md) | `openspec/plan/` workspace contract: default quick flow, role tasks files, checklist headings, helper sub-branch exception, scaffold command. |
| [`.agent/STALLED-WORKTREE-RECOVERY.md`](.agent/STALLED-WORKTREE-RECOVERY.md) | How `scripts/agent-stalled-report.sh` and `scripts/agent-autofinish-watch.sh` recover stalled `agent/*` worktrees; `__source-probe-*` cleanup steps. |

<!-- multiagent-safety:START -->
## Multi-Agent Safety (minimal)

Guardex is enabled by default. Disable via repo-root `.env` with `GUARDEX_ON=0`.

- Work from an `agent/*` branch + worktree — never edit the protected base (`main`/`dev`) directly. Start with `gx branch start "<task>" "<agent-name>"`, then `cd` into the printed worktree.
- Claim files before editing: `gx locks claim --branch "<agent-branch>" <file...>`.
- Finish completed work via PR + cleanup: `gx branch finish --branch "<agent-branch>" --via-pr --wait-for-merge --cleanup` (or `gx finish --all`).
- Default to the self-repairing gated ship — add `--gate-review --gate-autofix` so blocking findings are fixed and re-verified before the merge instead of leaving the PR open. Add `--gate-baseline` only where the base branch CI is already red. CI waits until the review is clean by default; `--no-gate-serial-ci` opts into overlapping CI with review. Posting a review is not merging: `gx pr-review` posts and exits; only `gx branch finish` merges.

Want the full multi-agent contract (Colony coordination, OpenSpec, token discipline, recovery)? Run `gx setup --contract`.
<!-- multiagent-safety:END -->

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
