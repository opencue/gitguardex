# AGENTS

This document is the agent contract for this repo. It applies identically to Codex, Claude Code, and any other agentic CLI working here. `CLAUDE.md` is a symlink to this file — do not edit them independently.

## ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in `.agent/PLANS.md`) from design to implementation.

## Objective

- Optimize for task completion with low token use.
- Prefer phase-based execution over conversational micro-steps.

## Token-Efficient Execution

### Planning

- Start each task with a plan of at most 4 bullets.
- Work in phases:
  1. minimal inspection
  2. grouped edits or grouped repo actions
  3. focused verification
  4. compact summary
- Low output alone is not a defect. A bounded run that finishes in roughly <=10 steps is usually fine; low output stretched across 20+ steps with rising input is fragmentation.
- Treat obvious follow-on actions as part of the active phase; do not stop for tiny internal checkpoints.
- If context grows or the session becomes fragmented, write a short working summary and continue from it.
- Checkpoint after each milestone or roughly every 15-25 tool calls: keep only `task`, `done`, `current status`, `next`, and the latest meaningful evidence; drop the raw transcript from active context.

### Token Discipline

- Do not re-read the same file, line range, or command output unless the file changed or new evidence requires it.
- Prefer targeted reads: `rg`, `head`, `tail`, `git diff`, and exact line ranges.
- Keep command output compact and relevant.
- Avoid repeated status checks unless something changed.
- Treat repeated `sed` / `cat` peeks, tiny diagnostic retries, and repeated `write_stdin` as red flags. When they appear, stop the probe loop and reset to one bounded phase.

### Command Discipline

- Batch related shell commands whenever safe.
- Prefer one-shot non-interactive commands, scripts, or exact invocations over interactive loops or repeated stdin driving.
- For diagnosis, gather the relevant evidence in one pass, then summarize once.
- If the session turns fragmented, collapse back to inspect once, patch once, verify once, and summarize once.

### Git And PR Workflow

- Treat local git and PR work as one bounded phase when possible: inspect status, stage intended files, commit, push, and check PR or CI.
- Do not narrate every trivial git step; summarize branch, commit, PR, and CI state once per phase.

### Reporting

- Use this format:
  1. Plan
  2. Actions taken
  3. Verification
  4. Result
- Keep reports concise and focused on blockers, material changes, and verification outcomes.

### Verification

- Always verify before finalizing.
- Choose the smallest verification that meaningfully proves the change.
- Do not run redundant checks.
- Pause only for destructive actions, ambiguous intent, missing credentials or access, or conflicting evidence.

## Environment

- Python: .venv/bin/python (uv, CPython 3.13.3)
- GitHub auth for git/API is available via env vars: `GITHUB_USER`, `GITHUB_TOKEN` (PAT). Do not hardcode or commit tokens.
- For authenticated git over HTTPS in automation, use: `https://x-access-token:${GITHUB_TOKEN}@github.com/<owner>/<repo>.git`

## Guardex Toggle

- Guardex is enabled for this repo by default.
- If the repo root `.env` sets `GUARDEX_ON=0`, `false`, `no`, or `off`, treat every Guardex-managed workflow requirement in this file as disabled for that repo.
- Disabled mode means: no required Guardex worktrees, no required Guardex lock-claim flow, no required Guardex PR/cleanup flow, and no required OpenSpec workflow from this contract until `GUARDEX_ON` is set back to a truthy value.
- `GUARDEX_ON=1`, `true`, `yes`, or `on` explicitly re-enables the Guardex workflow.
- Repo-root `.env` examples:
- `GUARDEX_ON=0` disables Guardex for this repo.
- `GUARDEX_ON=1` explicitly enables Guardex for this repo again.

## Code Conventions

The `/project-conventions` skill is auto-activated on code edits (PreToolUse guard).

| Convention              | Location                              | When                         |
| ----------------------- | ------------------------------------- | ---------------------------- |
| Code Conventions (Full) | `/project-conventions` skill          | On code edit (auto-enforced) |
| Git Workflow            | `.codex/conventions/git-workflow.md` | Commit / PR                  |

## UI/UX Skill Default (UI Pro Max)

- For any frontend/UI/UX request (new page, component, styling, layout, redesign, or UI review), **always load and apply** `.codex/skills/ui-ux-pro-max/SKILL.md` first.
- Treat `ui-ux-pro-max` as the default UI decision surface unless the user explicitly asks to skip it.
- Follow the skill workflow before implementation (including design-system guidance) so generated UI stays consistent and high quality.

## Git Hygiene Preference

- Prefer committing and pushing completed work by default unless the user explicitly asks to keep it local.
- Do not commit ephemeral local runtime artifacts (for example `.dev-ports.json` and `apps/logs/*.log`).
- Treat local OMX/Codex session state files as agent-ignored (as if they were in `.gitignore`) even when they appear in working tree status.
- Never stage or commit:
  - `.codex/settings.local.json`
  - `.claude/settings.local.json`
  - `.omc/project-memory.json`
  - `.omc/state/**`
  - `.omx/state/**`

## Claude Code Workflow

When Guardex is enabled, Claude Code sessions use the same agent-worktree + OpenSpec flow as Codex; there is no separate `claude-agent.sh` wrapper — Claude calls the generic scripts directly.

### Tiering (token-aware scaffolding)

`gx branch start` and `gx branch finish` accept `--tier {T0|T1|T2|T3}` to size the OpenSpec scaffolding to the change's blast radius. Default is `T3` (full scaffolding; current behavior). The tier is recorded in the bootstrap manifest so `finish` picks it up automatically.

| Tier | Use for | Scaffolding on `start` | Gates on `finish` |
|------|---------|------------------------|--------------------|
| `T0` | typos, dep bumps, format-only, comment-only | none (no `openspec/changes/` or `openspec/plan/` files) | tasks gate skipped |
| `T1` | ≤5 files, 1 capability, no API/schema change | `openspec/changes/<slug>/notes.md` + `.openspec.yaml` only | tasks gate skipped |
| `T2` | behavior change, API/schema, multi-module | full change workspace (`proposal.md`, `tasks.md`, `specs/.../spec.md`); no plan workspace | full gates |
| `T3` | cross-cutting, multi-agent, plan-driven | full change workspace + plan workspace with role `tasks.md` files | full gates |

Examples:

```bash
# T0 (typo / trivial): fastest path, no OpenSpec artifacts
gx branch start --tier T0 "fix-typo-in-readme" "claude-name"

# T1 (small fix): notes-only scaffold, commit message is the spec of record
gx branch start --tier T1 "tighten-retry-backoff" "claude-name"

# T2 (default for real behavior changes): full change spec, no plan workspace
gx branch start --tier T2 "add-oauth-endpoint" "claude-name"

# T3 (current default if --tier is omitted): plan workspace + full OpenSpec
gx branch start "refactor-payment-pipeline" "claude-name"
```

`finish` reads the tier from the manifest automatically; passing `--tier` on finish is only needed to override (e.g., upgrading to a fuller gate).

1. Start a sandbox worktree:

   ```bash
   gx branch start [--tier T0|T1|T2|T3] "<task>" "claude-<name>"
   ```

   Creates `agent/claude-<name>/<slug>` under `.omc/agent-worktrees/`, scaffolds the OpenSpec change + plan workspaces (sized by tier), and records the bootstrap manifest. Codex sessions keep using `.omx/agent-worktrees/`. Missing `codex-auth` silently falls back to an empty snapshot slug (expected for Claude sessions).

2. Work inside the sandbox only:

   ```bash
   cd .omc/agent-worktrees/agent__claude-<name>__<slug>
   gx locks claim --branch "agent/claude-<name>/<slug>" <file...>
   # implement + commit inside this worktree
   ```

   Do not edit the primary `dev` checkout; multiagent-safety rules apply unchanged.

3. Finish via PR + cleanup:

   ```bash
   gx branch finish \
     --branch "agent/claude-<name>/<slug>" \
     --base main --via-pr --wait-for-merge --cleanup
   ```

   Runs the OpenSpec tasks gate, merge-quality gate, and worktree prune — identical to the Codex path.

#### Default Claude finish (non-negotiable)

Claude's default completion command **must** include all four flags in this order: `--via-pr --wait-for-merge --cleanup`. Never stop at bare `--via-pr`; that strands commits and leaves worktrees dirty (see the stalled-worktree recovery section). The only time to deviate is when the user explicitly asks to keep the lane open (e.g. "don't merge yet", "leave the branch").

When branch protection blocks a direct merge, enable auto-merge as soon as the PR URL is known so `--wait-for-merge` can observe the state transition:

```bash
# finish also prints the PR URL / number; use it immediately:
gh pr merge <PR-NUMBER> --repo <owner>/<repo> --auto --squash
```

If checks are slow, extend the poll window rather than dropping the flag:

```bash
GUARDEX_FINISH_MERGE_TIMEOUT=3600 \
  gx branch finish \
    --branch "agent/claude-<name>/<slug>" \
    --base main --via-pr --wait-for-merge --cleanup
```

One-shot sweep for multiple finished lanes:

```bash
gx finish --all       # iterates every agent/* branch the current user owns
```

If `gx branch finish --cleanup` reports a worktree held by a `__source-probe-*` temp path, recover with:

```bash
git worktree remove --force .omc/agent-worktrees/agent__claude__<slug>
git worktree prune
git branch -D agent/claude/<slug>
```

Notes:

- Slash commands `/opsx:*` in `.claude/commands/opsx/` drive the OpenSpec artifact flow.
- `.claude/settings.json` already wires the `skill_activation` / `skill_guard` hooks, so project-conventions enforcement runs automatically on edits.
- `skill_guard` blocks most Bash commands while the shell is on `dev`; run the `gx branch ...`, `gx locks ...`, and `gx branch finish ...` commands from within the worktree, or prefix the invocation with `ALLOW_BASH_ON_NON_AGENT_BRANCH=1` when calling from the primary checkout.

### Stalled agent worktree recovery

The Guardex Codex launcher auto-finishes a branch only when the codex CLI exits cleanly inside it. If the agent is killed, crashes, runs out of budget, or is started directly via `gx branch start` without the launcher, the worktree is left dirty with no commits and no PR — a "stalled" worktree.

`scripts/agent-stalled-report.sh` is a quiet wrapper around `scripts/agent-autofinish-watch.sh --once --dry-run` that surfaces stalled worktrees. It is wired as a `SessionStart` hook in `.claude/settings.json`, so each Claude Code session begins with a one-line summary per stalled branch (and is silent when nothing is stalled).

To act on the report:

- Inspect: `bash scripts/agent-autofinish-watch.sh --once --dry-run`
- Auto-finish once (commit dirty changes, push, create PR, attempt merge): `bash scripts/agent-autofinish-watch.sh --once --auto-merge`
- Run the daemon (poll forever, auto-finish after `--idle-seconds`): `bash scripts/agent-autofinish-watch.sh --daemon --auto-merge`

Defaults: `--idle-seconds=900` (15 min of file silence before auto-commit) and `--branch-prefix=agent/`. The watcher is conservative — it never touches branches outside the configured prefix and only commits worktrees whose files have stopped changing.

## Multi-Agent Execution Contract (Default)

Use this contract whenever multiple agents are active in parallel.

The marker-managed `multiagent-safety` section below is the canonical lifecycle contract for branch/worktree startup, completion chain (`commit -> push -> create/update PR -> merged`), and PR/merge/cleanup evidence.

Apply these repo-specific supplements in addition to that canonical contract:

1. Local base safety
- Local `dev` is protected: never edit, stage, or commit task changes directly on `dev`.
- If currently checked out on `dev`, create the agent branch/worktree first and only then begin edits.
- Creating or attaching an agent worktree must never switch the primary local checkout branch.
- `agent-branch-start` and `agent-branch-finish` must fast-forward local `dev` from `origin/dev` before branch creation/merge.

2. Ownership and lock discipline
- Claim owned files before edits: `gx locks claim --branch "<agent-branch>" <file...>`.
- If `main.rs` is in scope, claim lock first: `python3 scripts/main_rs_lock.py claim --owner "<agent-name>" --branch "<agent-branch>"`.
- Non-integrator branches must not edit `main.rs` unless explicit emergency override is approved.
- Pre-commit blocks `agent/*` commits with unclaimed files or missing valid `main.rs` lock.

3. Shared behavior protection
- Do not delete, replace, or simplify critical paths (auth/session/proxy/API wiring) without explicit request or approved checkpoint plus regression coverage.
- Preserve parallel safety: never revert unrelated changes and report handoff conflicts.

4. Integrator finalization gate
- Final handoff must include files changed, behavior touched, verification commands/results, and risks/follow-ups.
- Integrator confirms no critical behavior loss, respected ownership boundaries, and verification gates passed.

## Versioning Rule

- If a change publishes or bumps a package version, the same change must also update the release notes / changelog entries. See [Documentation & Release Notes](#documentation--release-notes) for where to record change notes.

## Workflow (OpenSpec-first)

When Guardex is enabled, this repo uses **OpenSpec as the primary workflow and SSOT** for change-driven development.

### OpenSpec philosophy (enforced)

- fluid, not rigid
- iterative, not waterfall
- easy to apply, not process-heavy
- built for brownfield and greenfield work
- scalable from solo projects to large teams

### How to work (default)

1. Use the default artifact-guided flow first: `/opsx:propose <idea>` -> `/opsx:apply` -> `/opsx:archive`.
2. For **every** repo change (feature, fix, refactor, chore, test, config, docs), create/update an OpenSpec change in `openspec/changes/**` before editing code.
   Exception: helper agent branches that target another `agent/*` base branch are execution-only assists and must not create standalone OpenSpec change/spec/tasks docs; keep documentation on the owner change branch.
3. Keep artifacts editable throughout implementation (proposal/spec/design/tasks are living docs, not rigid phase gates).
4. Implement from `tasks.md`; keep code and specs in sync (update `spec.md` as behavior changes).
5. Keep `tasks.md` checkpoint status updated continuously during execution; mark items as soon as they complete (do not batch-update at the end).
6. Default `tasks.md` scaffolds and manual task edits must include a final completion/cleanup section that ends with PR merge + sandbox cleanup (`gx branch finish ... --cleanup` or `gx finish --all`) and captures PR URL + final `MERGED` handoff evidence.
7. Validate specs locally: `openspec validate --specs`.
8. Verify before archiving (`/opsx:verify <change>` when applicable); never archive unverified changes.

### OpenSpec tooling freshness (required)

- Keep the global CLI current:
  - `npm install -g @fission-ai/openspec@latest`
- Refresh project-local AI guidance/slash commands after updates:
  - `openspec update`
- If expanded workflow commands are needed (`/opsx:new`, `/opsx:continue`, `/opsx:ff`, `/opsx:verify`, `/opsx:sync`, `/opsx:bulk-archive`, `/opsx:onboard`), select a profile and refresh:
  - `openspec config profile <profile-name>`
  - `openspec update`

### Source of Truth

- **Specs/Design/Tasks (SSOT)**: `openspec/`
  - Active changes: `openspec/changes/<change>/`
  - Main specs: `openspec/specs/<capability>/spec.md`
  - Archived changes: `openspec/changes/archive/YYYY-MM-DD-<change>/`

## Documentation & Release Notes

- **Do not add/update feature or behavior documentation under `docs/`**. Use OpenSpec context docs under `openspec/specs/<capability>/context.md` (or change-level context under `openspec/changes/<change>/context.md`) as the SSOT.
- **Do not edit `CHANGELOG.md` directly.** Leave changelog updates to the release process; record change notes in OpenSpec artifacts instead.

### Documentation Model (Spec + Context)

- `spec.md` is the **normative SSOT** and should contain only testable requirements.
- Use `openspec/specs/<capability>/context.md` for **free-form context** (purpose, rationale, examples, ops notes).
- If context grows, split into `overview.md`, `rationale.md`, `examples.md`, or `ops.md` within the same capability folder.
- Change-level notes live in `openspec/changes/<change>/context.md` or `notes.md`, then **sync stable context** back into the main context docs.

Prompting cue (use when writing docs):
"Keep `spec.md` strictly for requirements. Add/update `context.md` with purpose, decisions, constraints, failure modes, and at least one concrete example."

### Commands (recommended)

- Default flow (recommended): `/opsx:propose <idea>` -> `/opsx:apply` -> `/opsx:archive`
- Expanded flow start: `/opsx:new <kebab-case>`
- Continue artifacts: `/opsx:continue <change>`
- Fast-forward artifacts: `/opsx:ff <change>`
- Verify before archive: `/opsx:verify <change>`
- Sync delta specs → main specs: `/opsx:sync <change>`
- Bulk archive completed changes: `/opsx:bulk-archive`
- Guided onboarding workflow: `/opsx:onboard`
- Create/refresh plan workspace: `/opsx:plan <plan-slug>`
- Update plan checkpoint: `/opsx:checkpoint <plan-slug> <role> <checkpoint-id> <state> <text...> [--phase <phase-id>]` (`--phase` syncs the matching line in `openspec/plan/<slug>/phases.md` using the same `--state`)
- Watch team -> plan checkpoints: `/opsx:watch-plan <team-name> <plan-slug>`

## Plan Workspace Contract (`openspec/plan`)

Use `openspec/plan/README.md` as the operational runbook and `openspec/plan/PLANS.md` as the planner narrative-writing contract.

Default quick flow:
1. Create/maintain `openspec/plan/<plan-slug>/`.
2. Create/maintain `openspec/plan/<plan-slug>/open-questions.md`.
3. Keep `open-questions.md` current; when Codex/Claude hits an unresolved question, branching decision, or blocker that should survive chat, record it there as an unchecked `- [ ]` item.
4. Keep role `tasks.md` files current (`planner`, `architect`, `critic`, `executor`, `writer`, `verifier`).
5. Keep checklist headings visible: `## 1. Spec`, `## 2. Tests`, `## 3. Implementation`, `## 4. Checkpoints`, plus a final cleanup section (`## 5. Cleanup` or `## 6. Cleanup`).
6. Update checkboxes continuously while work progresses.
7. Execute from approved `planner/plan.md` with role ownership.
8. Verify with evidence before archive/finish.

Helper sub-branch exception:
- When a helper branch targets another `agent/*` owner branch, implementation is allowed in helper lanes, but OpenSpec change/spec/tasks artifacts stay owned by the owner branch.

Scaffold command:

```bash
scripts/openspec/init-plan-workspace.sh <plan-slug>
```

<!-- multiagent-safety:START -->
## Multi-Agent Execution Contract: Guardex + Colony

### Repo toggle

Guardex is enabled by default.

If the repo-root `.env` sets any of these values, treat this entire Guardex contract as disabled for the repo:

```text
GUARDEX_ON=0
GUARDEX_ON=false
GUARDEX_ON=no
GUARDEX_ON=off
```

When disabled, do not require Guardex worktrees, lock claims, completion flow, or OpenSpec workflow until `GUARDEX_ON` is re-enabled.

To explicitly enable:

```text
GUARDEX_ON=1
```

### Core rules

- Work from an `agent/*` branch and worktree, never directly on the protected base branch.
- Claim files before edits.
- Use Colony for coordination before falling back to OMX state/notepad.
- Prefer fff MCP tools for file search whenever available; do not route file search through RTK when fff can answer it.
- Use OpenSpec for durable behavior contracts and change-driven work.
- Keep outputs compact: less word, same proof.
- Commit, push, and open/update a PR for completed work unless the user explicitly says to keep it local.
- Do not embed stale memory dumps, generated status snapshots, PR transcripts, session history, or long logs in this file.

### Task-size routing

Small tasks stay direct and caveman-only.

For typos, single-file tweaks, one-liners, version bumps, comment-only changes, or similarly bounded asks, solve directly and do not escalate into heavy orchestration just because a keyword appears.

Treat these prefixes as explicit lightweight escape hatches:

- `quick:`
- `simple:`
- `tiny:`
- `minor:`
- `small:`
- `just:`
- `only:`

Promote to full Guardex / OMX orchestration only when scope grows into:

- multi-file behavior change
- API/schema work
- refactor
- migration
- architecture
- cross-cutting scope
- long prompt
- multi-agent execution

### Colony coordination loop

Use Colony as the primary coordination surface.

On every startup, resume, follow-up, or "continue" request, run this order:

1. `mcp__colony__hivemind_context`
2. `mcp__colony__attention_inbox`
3. `mcp__colony__task_ready_for_agent`
4. `mcp__colony__search` only when prior decisions, earlier lanes, file history, or error context matter.

Rules:

- Use `task_ready_for_agent` to choose work.
- Use `task_list` only for browsing/debugging. Do not use `task_list` as the normal work picker.
- If an agent reaches for `task_list` repeatedly while choosing work, stop and call `task_ready_for_agent` instead. `task_list` is an inventory tool, not a scheduler.
- Before editing files on an active task, call `task_claim_file` for each touched file.
- Use `task_post` for task-thread notes, decisions, blockers, and working-state updates.
- Use `task_message` / `task_messages` for directed agent-to-agent communication.
- Use `get_observations` only after compact Colony tools return IDs worth hydrating.

Fallback:

- Colony is considered unavailable only when the MCP namespace is missing, the tool call fails, or the installed Colony server does not expose the required tool.
- If `attention_inbox` or `task_ready_for_agent` is missing, fall back to `hivemind_context`, then `task_list`, then hydrate only the relevant task IDs.
- Do not skip Colony just because OMX state exists. OMX is fallback, not the first coordination source.
- Read `.omx/state` and `.omx/notepad.md` only when Colony is unavailable, missing the needed state, or the task explicitly depends on legacy OMX state.
- Keep `.omx/notepad.md` lean: live handoffs only.

### Working-state notes

Colony is preferred over generic notepad state.

A working-state note should be task-scoped, searchable, and useful to another agent resuming the lane.

When saving progress, use a task-scoped Colony note when possible:

```text
task_post kind=note
content="branch=<branch>; task=<task>; blocker=<blocker>; next=<next>; evidence=<path|command|PR|spec>"
```

Use exactly these fields for handoff-style notes:

- `branch`
- `task`
- `blocker`
- `next`
- `evidence`

Do not store long proof dumps, stale narrative, or full logs in notepads. Put bulky proof in OpenSpec artifacts, PRs, or command output.

### Token / context budget

Default: less word, same proof.

- For prompts about `token inefficiency`, `reviewer mode`, `minimal token overhead`, or session waste patterns, switch into low-overhead mode.
- Plan in at most 4 bullets.
- Execute by phase.
- Batch related reads and commands.
- Avoid duplicate reads and interactive loops.
- Keep outputs compact.
- Verify once per phase.
- Low output alone is not a defect. A bounded run that finishes in roughly <=10 steps is usually fine.
- Low output spread across 20+ steps with rising per-turn input is fragmentation and should be treated as context growth first.
- Startup / resume summaries stay tiny: `branch`, `task`, `blocker`, `next`, and `evidence`.
- Front-load scaffold/path discovery into one grouped inspection pass. Avoid serial `ls` / `find` / `rg` / `cat` retries that rediscover the same path state.
- Treat repeated `write_stdin`, repeated `sed` / `cat` peeks, and tiny diagnostic follow-up checks as strong negative signals.
- If a session turns fragmented, collapse back to inspect once, patch once, verify once, and summarize once.
- Tool / hook summaries stay tiny: command, status, last meaningful lines only. Drop routine hook boilerplate.
- Keep raw terminal interaction out of long-lived context. For `write_stdin` or interactive babysitting, retain only process, action sent, current result, and next action.
- Keep execution log separate from reasoning context: full commands/stdout belong in logs, while prompt context keeps only the latest 1-2 checkpoints plus the newest tool-result summary.
- Treat local edit/commit, remote publish/PR, CI diagnosis, and cleanup as bounded phases.
- Do not spend fresh narration or approval turns on obvious safe follow-ons inside an already authorized phase unless the risk changes.

### FFF file search

Use the fff MCP tools for all file search operations instead of default tools, including RTK shell wrappers.

If fff MCP tools are unavailable in the current client, fall back to `rtk grep`, `rtk find`, `rtk ls`, or `rg` and keep output compact.

### Caveman style

Commentary and progress updates use smart-caveman `ultra` by default:

- Answer order stays fixed: answer first, cause next, fix or next step last.
- drop filler
- use fragments when clear
- answer first
- cause next
- fix or next step last

Keep exact literals unchanged:

- code
- commands
- file paths
- flags
- env vars
- URLs
- numbers
- timestamps
- error text

Switch back to `lite` or normal wording for:

- security warnings
- irreversible actions
- privacy/compliance notes
- ordered instructions where fragments may confuse
- confused users
- commits
- PR text
- specs
- logs
- blocker evidence

Never caveman-compress commands, file paths, specs, logs, or blocker evidence.

### Isolation

Every task runs on a dedicated `agent/*` branch and worktree.

Start with:

```bash
gx branch start "<task>" "<agent-name>"
```

Treat the base branch (`main` / `dev`) as read-only while an agent branch is active.

For every new task, including follow-up work in the same chat/session, if an assigned agent sub-branch/worktree is already open, continue in that sub-branch instead of creating a fresh lane unless the user explicitly redirects scope.

Never implement directly on the local/base branch checkout. Keep it unchanged and perform all edits in the agent sub-branch/worktree.

### Primary-tree lock

On the primary checkout, do not run:

```bash
git checkout <ref>
git switch <ref>
git switch -c ...
git checkout -b ...
git worktree add <path> <existing-agent-branch>
```

Allowed on primary:

```bash
git fetch
git pull --ff-only
```

To work on any `agent/*` branch, run `gx branch start ...` first, then `cd` into the printed worktree path and run every subsequent git command from inside that worktree.

If you are about to type `git checkout agent/...` or `git switch agent/...` from the primary checkout, stop. That is the mistake that flips primary onto an agent branch.

### Dirty-tree rule

Finish or stash edits inside the worktree they belong to before any branch switch on primary.

The post-checkout guard may auto-stash a dirty primary tree as:

```text
guardex-auto-revert <ts> <prev>-><new>
```

That is a safety net, not a workflow. Do not rely on it routinely.

Recover stashed changes with:

```bash
git stash list | grep 'guardex-auto-revert'
```

### Ownership

Before editing, claim files.

Preferred Colony path when on an active task:

```text
mcp__colony__task_claim_file
```

Guardex lock path:

```bash
gx locks claim --branch "<agent-branch>" <file...>
```

Before deleting, confirm the path is in your claim.

Do not edit outside your scope unless reassigned.

If another agent owns or recently touched nearby code:

1. read latest Colony context
2. post a handoff or question
3. avoid reverting unrelated changes
4. report conflicts instead of overwriting

### Handoff gate

Before editing, post a one-line handoff note through Colony `task_post` when a task is active.

Use `.omx/notepad.md` only when Colony is unavailable or the lane explicitly depends on legacy OMX state.

Handoff shape:

```text
branch=<branch>; task=<task>; blocker=<blocker>; next=<next>; evidence=<path|command|PR|spec>
```

Re-read latest Colony context before replacing another agent's code.

### Completion

Finish with:

```bash
gx branch finish --branch "<agent-branch>" --via-pr --wait-for-merge --cleanup
```

or:

```bash
gx finish --all
```

Task is complete only when:

1. changes are committed
2. branch is pushed
3. PR URL is recorded
4. PR state is `MERGED`
5. sandbox worktree is pruned
6. final handoff records proof

If anything blocks, append a `BLOCKED:` note and stop. Do not half-finish.

OMX completion policy: when a task is done, the agent must run `gx branch finish --branch "<agent-branch>" --via-pr --wait-for-merge --cleanup` (or `gx finish --all`) instead of standalone `git push` / `gh pr` commands. The finish flow owns commit, push, PR creation/update, merge wait, and sandbox cleanup.

External approval boundary:

- Guardex cannot bypass Codex host approval prompts or external-remote policy decisions.
- When the host blocks a publish or finish command, request approval for the narrow `gx branch finish ...` command, or for the exact session wrapper that invokes it, and continue after approval.
- Do not replace the finish flow with repeated standalone `git push` / `gh pr` attempts. That increases approval churn and can strand PR, merge, or cleanup state.

### Parallel safety

Assume other agents edit nearby.

- Never revert unrelated changes.
- Never simplify or delete critical shared paths without explicit request and regression coverage.
- Report conflicts in the handoff.
- Prefer compatibility-preserving changes over endpoint-specific rewrites when other agents may be changing adjacent systems.

### Reporting

Every completion handoff includes:

```text
branch
task
files changed
behavior touched
verification commands/results
PR URL
merge state
sandbox cleanup state
risks/follow-ups
```

If blocked, use:

```text
BLOCKED:
branch=<branch>
task=<task>
blocker=<blocker>
next=<next>
evidence=<path|command|PR|spec>
```

### Open questions

If Codex/Claude hits an unresolved question, branching decision, or blocker that should survive chat, record it in:

```text
openspec/plan/<plan-slug>/open-questions.md
```

as an unchecked item:

```md
- [ ] Question or blocker...
```

Resolve it in-place when answered instead of burying it in chat-only notes.

### OpenSpec

OpenSpec is the source of truth for change-driven repo work.

For change-driven tasks, keep:

```text
openspec/changes/<slug>/tasks.md
```

current during work, not batched at the end.

Task scaffolds and manual task edits must include a final completion/cleanup section that ends with PR merge + sandbox cleanup and records PR URL + final `MERGED` evidence.

Validate specs before archive:

```bash
openspec validate --specs
```

Never archive unverified work.

For `T0` / small `T1` lanes, use the compact Colony spec path when available. One Colony handoff plus `colony-spec.md` is enough. Do not create proposal/spec/tasks unless the task grows.

For `T2` / `T3` lanes, keep proposal, spec, design, and tasks live while implementing.

### Version bumps

If a change bumps a published version, the same PR records release notes in the appropriate OpenSpec artifact or release-note mechanism for the repo.

Do not edit `CHANGELOG.md` directly unless the repo explicitly requires manual changelog edits.

### Verification gates

Before claiming completion, run the narrowest meaningful verification for the touched area.

Examples:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

If a command cannot run, record:

```text
command
reason it could not run
risk
next
```

Do not claim green verification without command output evidence.

### What not to put in this file

Do not embed:

- stale memory dumps
- PR transcripts
- long logs
- generated status snapshots
- session history
- full OpenSpec examples
- repeated copies of long workflow docs

Keep this section as the hard multi-agent contract. Put long examples and recovery docs in repo-specific workflow docs.

<!-- multiagent-safety:END -->

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
