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
- Use the fff MCP tools for all file search operations instead of default tools.
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

### RTK command compression

When `rtk` is available, prefer it for noisy shell discovery and verification.

- Files: `rtk ls .`, `rtk read <file>`, `rtk read <file> -l aggressive`, `rtk smart <file>`, `rtk find "<glob>" .`, `rtk grep "<pattern>" .`, `rtk diff <a> <b>`.
- Git and GitHub: `rtk git status`, `rtk git diff`, `rtk git log -n 10`, `rtk gh pr list`, `rtk gh pr view <id>`.
- Tests and builds: `rtk test <cmd>`, `rtk err <cmd>`, `rtk jest`, `rtk vitest`, `rtk playwright test`, `rtk pytest`, `rtk cargo test`, `rtk tsc`, `rtk lint`.
- Runtime and data probes: `rtk docker ps`, `rtk docker logs <container>`, `rtk kubectl pods`, `rtk json <file>`, `rtk log <file>`, `rtk curl <url>`.
- Savings checks: `rtk gain`, `rtk discover`, and `rtk session`.
- Use `rtk proxy <command>` only when raw passthrough is required.
- Do not wrap machine-readable commands with RTK when code parses stdout (`--porcelain`, `--json`, NUL-delimited output, or exact stdout contracts).
- If `rtk` is missing, use raw commands and summarize only meaningful lines.

### FFF file search

Use the fff MCP tools for all file search operations instead of default tools.

If `fff-mcp` is missing, run `gx setup` or `gx doctor` and follow the required system tool warning before falling back to repo-local search.

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

OMX completion policy: when a task is done, the agent must commit the task changes, push the agent branch, and create/update a PR before considering the branch complete.

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
