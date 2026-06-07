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
