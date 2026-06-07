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
- Finish completed work with `gx branch finish --branch "<agent-branch>" --via-pr --wait-for-merge --cleanup`. Never stop at bare `--via-pr`.
- Commit, push, and open/update a PR for completed work unless the user explicitly says to keep it local.
- Use OpenSpec for change-driven work; create/update `openspec/changes/<slug>/` before editing code (helper agent sub-branches excepted).
- Keep outputs compact: less word, same proof.
- Do not commit ephemeral runtime artifacts or local settings: `.dev-ports.json`, `apps/logs/*.log`, `.codex/settings.local.json`, `.claude/settings.local.json`, `.omc/project-memory.json`, `.omc/state/**`, `.omx/state/**`.
- Do not embed stale memory dumps, PR transcripts, session history, or long logs in this file.
- Frontend/UI/UX requests: load `.codex/skills/ui-ux-pro-max/SKILL.md` first.
- The `multiagent-safety` marker section below is machine-managed. Do not edit between markers.

## Workflow cheatsheet

```bash
# 1. Start a sandbox worktree (tier sizes OpenSpec scaffolding):
ALLOW_BASH_ON_NON_AGENT_BRANCH=1 \
  gx branch start [--tier T0|T1|T2|T3] "<task>" "claude-<name>"

# 2. Work inside the printed worktree path:
cd .omc/agent-worktrees/gitguardex__claude-<name>__<slug>
gx locks claim --branch "agent/claude-<name>/<slug>" <file...>
# implement + commit inside this worktree

# 3. Validate specs (before archive / finish on T2/T3):
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

Tier guide (sized by blast radius; **default is `T1`** when `--tier` is omitted —
escalate with `--tier T2` for a behavior change or `--tier T3` for plan-driven work):

| Tier | Use for | Scaffolding | Gates |
|------|---------|-------------|-------|
| `T0` | typos, dep bumps, format-only | none | tasks gate skipped |
| `T1` | ≤5 files, 1 capability, no API/schema | notes.md only | tasks gate skipped |
| `T2` | behavior change, API/schema, multi-module | full change workspace | full gates |
| `T3` | cross-cutting, multi-agent, plan-driven | change + plan workspace | full gates |

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

## Source of Truth (OpenSpec)

- **Specs/Design/Tasks (SSOT)**: `openspec/`
  - Active changes: `openspec/changes/<change>/`
  - Main specs: `openspec/specs/<capability>/spec.md`
  - Archived changes: `openspec/changes/archive/YYYY-MM-DD-<change>/`
- `spec.md` is normative (testable requirements only); free-form context lives in `openspec/specs/<capability>/context.md`.
- Do not add feature/behavior docs under `docs/`. Do not edit `CHANGELOG.md` directly.
- Validate: `openspec validate --specs`. Verify before archive: `/opsx:verify <change>`.
- Full OpenSpec workflow, philosophy, command list, and documentation model: [`.agent/OPENSPEC-WORKFLOW.md`](.agent/OPENSPEC-WORKFLOW.md).

## Versioning Rule

If a change publishes or bumps a package version, the same change must also update the release notes / changelog entries (record change notes in OpenSpec artifacts, not `CHANGELOG.md`).

## Extracted contracts (subdocs)

| Subdoc | What's inside |
|---|---|
| [`.agent/TOKEN-DISCIPLINE.md`](.agent/TOKEN-DISCIPLINE.md) | Token-efficient execution: planning phases, token/command/git discipline, reporting format, verification, and multi-agent token budget supplement. |
| [`.agent/MULTI-AGENT-EFFICIENCY.md`](.agent/MULTI-AGENT-EFFICIENCY.md) | Token-efficient multi-agent work: scout-then-implement, one-job-per-agent, parallel split-role review, model routing, and when not to fan out. |
| [`.agent/GUARDEX-TOGGLE.md`](.agent/GUARDEX-TOGGLE.md) | `GUARDEX_ON` toggle semantics in repo-root `.env` (disable / re-enable Guardex workflow). |
| [`.agent/CLAUDE-CODE-WORKFLOW.md`](.agent/CLAUDE-CODE-WORKFLOW.md) | Full Claude Code workflow: tiering table with examples, sandbox + lock + finish steps, default Claude finish (non-negotiable), `skill_guard` notes. |
| [`.agent/OPENSPEC-WORKFLOW.md`](.agent/OPENSPEC-WORKFLOW.md) | OpenSpec-first workflow, philosophy, tooling-freshness commands, source-of-truth layout, documentation model (spec + context), and `/opsx:*` command list. |
| [`.agent/MULTI-AGENT-CONTRACT.md`](.agent/MULTI-AGENT-CONTRACT.md) | Repo-specific supplements to the marker-managed multiagent-safety contract: local base safety, ownership/lock discipline (incl. `main.rs` lock), shared behavior protection, integrator finalization gate. |
| [`.agent/PLAN-WORKSPACE.md`](.agent/PLAN-WORKSPACE.md) | `openspec/plan/` workspace contract: default quick flow, role tasks files, checklist headings, helper sub-branch exception, scaffold command. |
| [`.agent/STALLED-WORKTREE-RECOVERY.md`](.agent/STALLED-WORKTREE-RECOVERY.md) | How `scripts/agent-stalled-report.sh` and `scripts/agent-autofinish-watch.sh` recover stalled `agent/*` worktrees; `__source-probe-*` cleanup steps. |

<!-- multiagent-safety:START -->
## Multi-Agent Execution Contract

### Toggle

Guardex is enabled by default. Disable via repo-root `.env` with `GUARDEX_ON=0|false|no|off`. Re-enable with `GUARDEX_ON=1`.

### Core rules

- Work from an `agent/*` branch + worktree. **Never** edit the protected base directly.
- Claim files before editing. Confirm a path is in your claim before deleting it.
- Commit, push, and open/update a PR for completed work unless the user says keep-local.
- Keep outputs and notes compact. Less word, same proof.

### Task-size routing

Small tasks stay direct and caveman-only.

For typos, single-file tweaks, one-liners, version bumps, comment-only changes, or similarly bounded asks, solve directly and do not escalate into heavy orchestration just because a keyword appears.

Lightweight escape prefixes: `quick:`, `simple:`, `tiny:`, `minor:`, `small:`, `just:`, `only:`.

Promote to full Guardex / OMX orchestration only when scope grows into multi-file behavior change, API/schema work, refactor, migration, architecture, cross-cutting scope, long prompt, or multi-agent execution.

### Isolation (the load-bearing rule)

Every task = one `agent/*` branch + worktree. Start with:

```bash
gx branch start "<task>" "<agent-name>"
```

Then `cd` into the printed worktree path. Every subsequent git command runs from inside that worktree.

If a worktree is already open for this chat/session, **continue in it** instead of spawning a fresh lane unless the user redirects scope.

### Primary-tree lock

On the primary checkout, do not run:

```bash
git checkout <ref>          git switch <ref>
git switch -c ...           git checkout -b ...
git worktree add <p> <agent-branch>
```

Allowed on primary: `git fetch`, `git pull --ff-only`. Anything else needs `gx branch start` first.

If you are about to type `git checkout agent/...` from the primary checkout, **stop** — that is the mistake that flips primary onto an agent branch.

### Dirty-tree rule

Finish or stash edits inside the worktree they belong to before any branch switch on primary. The post-checkout guard may auto-stash a dirty primary tree as `guardex-auto-revert <ts> <prev>-><new>` — that is a safety net, not a workflow.

Recover: `git stash list | grep 'guardex-auto-revert'`.

### Ownership

Before editing, claim files:

```bash
gx locks claim --branch "<agent-branch>" <file...>
```

If another agent owns nearby code:
1. read the latest context for that lane
2. post a handoff / question
3. avoid reverting unrelated changes
4. report conflicts instead of overwriting

### Handoff format

When posting handoff or working-state notes (`.omx/notepad.md`, PR description, or whichever coordination surface the repo uses), use these fields:

```text
branch=<branch>; task=<task>; blocker=<blocker>; next=<next>; evidence=<path|command|PR|spec>
```

No long proof dumps, no stale narrative, no full logs. Bulky proof goes in OpenSpec artifacts, PRs, or command output.

### Completion

Finish with:

```bash
gx branch finish --branch "<agent-branch>" --via-pr --wait-for-merge --cleanup
# or:
gx finish --all
```

Task scaffolds and manual task edits must include a final completion/cleanup section that ends with PR merge + sandbox cleanup and records PR URL + final `MERGED` evidence.

Task is complete only when **all six** are true:

1. changes committed
2. branch pushed
3. PR URL recorded
4. PR state = `MERGED`
5. sandbox worktree pruned
6. final handoff records proof

If blocked, append a `BLOCKED:` note and stop. Do not half-finish.

Use the finish flow instead of standalone `git push` / `gh pr` commands. The finish flow owns commit, push, PR creation/update, merge wait, and sandbox cleanup; standalone fallbacks strand PR / merge / cleanup state.

### External approval boundary

Guardex cannot bypass Codex host approval prompts or external-remote policy decisions. When the host blocks a publish or finish command, request approval for the narrow `gx branch finish ...` command, or for the exact session wrapper that invokes it, and continue after approval. Do not replace the finish flow with repeated standalone `git push` / `gh pr` attempts — that increases approval churn and can strand state.

### Parallel safety

Assume other agents edit nearby. Never revert unrelated changes. Never simplify or delete critical shared paths without explicit request + regression coverage. Prefer compatibility-preserving changes when adjacent systems may be in motion.

### Reporting

Every completion handoff includes: branch, task, files changed, behavior touched, verification commands + results, PR URL, merge state, sandbox cleanup state, risks/follow-ups.

Blocked? Use:

```text
BLOCKED:
branch=<branch>
task=<task>
blocker=<blocker>
next=<next>
evidence=<path|command|PR|spec>
```

### Verification gates

Before claiming completion, run the narrowest meaningful verification (`pnpm test`, `pnpm typecheck`, `pnpm lint`, etc. — whatever fits the touched area). Do not claim green without command output evidence. If a command can't run, record command / reason / risk / next.

### Open questions

Persist unresolved questions or blockers into `openspec/plan/<plan-slug>/open-questions.md` as unchecked items. Resolve in-place rather than burying in chat.

### Optional companion tooling (use if installed)

- **fff MCP** (file search): prefer for all file search; fall back to `rtk grep`/`rtk find` or `rg`.
- **rtk** (shell compression): wrap noisy discovery (`rtk ls`/`grep`/`find`/`read`), git/gh (`rtk git status`/`gh pr list`), and verification (`rtk tsc`/`lint`/`test`). Do **not** wrap machine-readable commands (`--porcelain`, `--json`, exact stdout contracts).
- **OpenSpec**: keep `openspec/changes/<slug>/tasks.md` current during work, not batched. Validate with `openspec validate --specs` before archive.

### Token / context budget

Default: less word, same proof.

- Plan in ≤4 bullets, execute by phase, batch reads/commands.
- Verify once per phase. A bounded ≤10-step run is fine.
- 20+ steps with rising per-turn input = fragmentation → collapse to inspect once, patch once, verify once, summarize once.
- Startup/resume summaries stay tiny: `branch`, `task`, `blocker`, `next`, `evidence`.
- Keep raw terminal interaction out of long-lived context: retain only process, action sent, current result, next action.
- Full commands/stdout belong in logs; prompt context keeps only the latest 1–2 checkpoints plus the newest tool-result summary.

### Multi-agent token efficiency

Fan-out saves tokens only when each agent has a narrow job and returns a compact result. When reviewing or implementing here:

- **Scout, then implement.** A cheap-model subagent locates the 3-5 files that matter and returns a summary; edit those inline. Don't read 20+ files in the main context to find the 4 that count.
- **One agent, one job.** Each subagent gets a single objective and returns one output (analyze OR fix), not a muddle of both.
- **Review by parallel role.** Run correctness / security / consistency reviewers in parallel and synthesize — cheaper and sharper than one reviewer holding the whole diff. The finish review-gate is the place for it.
- **Route models to task weight.** scan/explore/draft → cheap (e.g. `haiku`); implement/debug → mid (`sonnet`); architecture/complex review → top (`opus`). `CLAUDE_CODE_SUBAGENT_MODEL` sets the subagent tier.
- **Don't fan out trivial work.** One-file tweaks and bounded edits stay direct (see Task-size routing) — a subagent's setup cost only pays off on a wide read or review surface.

### Version bumps

If a change bumps a published version, the same PR records release notes in the appropriate OpenSpec artifact or release-note mechanism for the repo. Do not edit `CHANGELOG.md` directly unless the repo explicitly requires manual changelog edits.

### What not to put in this file

No stale memory dumps, PR transcripts, long logs, generated status snapshots, session history, full OpenSpec examples, or duplicate workflow docs. This block is the hard contract — long examples and recovery docs live in repo-specific workflow files.
<!-- multiagent-safety:END -->

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
