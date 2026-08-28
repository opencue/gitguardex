<!-- multiagent-safety:START -->
## Multi-Agent Execution Contract

### Toggle

Guardex is enabled by default. Disable via repo-root `.env` with `GUARDEX_ON=0|false|no|off`. Re-enable with `GUARDEX_ON=1`.

Worktree policy defaults to strict `always`. Opt a repository into adaptive
routing with `GUARDEX_WORKTREE_MODE=adaptive` in `.env` or
`git config multiagent.worktreeMode adaptive`.

### Core rules

- In strict `always` mode, work from an `agent/*` branch + worktree. **Never** edit the protected base directly.
- In adaptive mode, bounded single-agent work may remain on the current checkout after the radar and ownership checks below pass.
- Claim files before editing in isolated lanes. Confirm a path is in your claim before deleting it.
- Commit, push, and open/update a PR for completed work unless the user says keep-local.
- Keep outputs and notes compact. Less word, same proof.

### Task-size routing

Small tasks stay direct and caveman-only when adaptive mode is enabled and no
other writer or overlapping change is present. Strict mode still isolates them.

For typos, single-file tweaks, one-liners, version bumps, comment-only changes, or similarly bounded asks, solve directly and do not escalate into heavy orchestration just because a keyword appears.

Lightweight escape prefixes: `quick:`, `simple:`, `tiny:`, `minor:`, `small:`, `just:`, `only:`.

Promote to an isolated Guardex lane when scope grows into a multi-file behavior
change, API/schema work, refactor, migration, architecture, cross-cutting or
long-lived work, or multi-agent execution. Orchestration alone does not require
OpenSpec.

OpenSpec is opt-in. Do not create or update OpenSpec artifacts unless the user asks for them, the task continues an existing OpenSpec change, or an explicit T2/T3 workflow is selected.

### Adaptive lane selection

Before direct edits, run `gx status`, inspect active lanes with
`gx mcp list-agents --no-prs`, and check every intended path with
`gx mcp who-owns <file>`. Also inspect the current checkout's dirty paths.

Stay direct only for bounded work when no competing writer, ownership claim, or
dirty-path overlap exists. Pivot before editing (or before expanding scope) if
another writer appears, a target is owned/dirty elsewhere, or the task becomes
substantial or long-lived.

### Isolation (the load-bearing rule)

Start an isolated lane with:

```bash
gx branch start --new --no-transfer "<task>" "<agent-name>"
```

Then `cd` into the printed worktree path. Every subsequent git command runs from inside that worktree.

If a worktree is already open for this chat/session, **continue in it** instead of spawning a fresh lane unless the user redirects scope.

### Primary-tree lock

In strict mode, or after adaptive routing selects isolation, do not run these on
the primary checkout:

```bash
git checkout <ref>          git switch <ref>
git switch -c ...           git checkout -b ...
git worktree add <p> <agent-branch>
```

In adaptive direct mode, ordinary bounded edits/commits/pushes are allowed after
the radar preflight passes. Branch switching and worktree manipulation still use
`gx branch start` rather than raw Git commands.

If you are about to type `git checkout agent/...` from the primary checkout, **stop** — that is the mistake that flips primary onto an agent branch.

### Dirty-tree rule

Finish or stash edits inside the worktree they belong to before any branch switch on primary. The post-checkout guard auto-reverts only a clean primary tree. If the primary tree is dirty, it leaves the branch and files in place and prints a manual recovery hint instead of stashing or reverting someone else's work.

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

No long proof dumps, no stale narrative, no full logs. Bulky proof goes in PRs or command output; do not create OpenSpec artifacts only to hold routine progress.

### Completion

Direct adaptive work uses the repository's ordinary commit/push flow. Finish an
isolated lane with:

```bash
gx branch finish --branch "<agent-branch>" --via-pr --wait-for-merge --cleanup
# or:
gx finish --all
```

**Default to the self-repairing gated ship.** Unless the user says keep-local, end
a task with the gate armed so review findings are fixed and re-verified before the
merge, instead of leaving a PR open for a human to chase:

```bash
gx branch finish --branch "<agent-branch>" --base <base> \
  --via-pr --wait-for-merge --cleanup \
  --gate-review --gate-autofix
```

What each flag buys, and why they are not optional in an unattended run:

- `--gate-review` — fail-CLOSED. Blocks the merge on any HIGH/CRITICAL finding, on
  red CI, and on GitHub reporting the PR unmergeable. A provider error or timeout
  also blocks; it is never read as clean.
- `--gate-autofix` — on a blocking verdict, repairs the findings in the worktree,
  pushes, and RE-REVIEWS with a fresh provider run before deciding. Bounded by
  `--gate-autofix-rounds N` (1-5, default 1). A repair round that changes nothing
  stops the loop rather than spinning.
- `--gate-baseline` — add this only in a repo whose base branch CI is already red.
  It gates on "this change adds no NEW failing check" instead of absolute green,
  comparing against the base branch and the last merged PR.

Three knobs for how long the gate takes without removing a gate:

- CI waits for the review by default: the PR remains draft while the provider
  runs, preserving GitHub's hard "draft PRs cannot merge" barrier until the
  verdict is clean. `--no-gate-serial-ci` opts into promoting before review so
  CI overlaps the review — faster, but it leaves a ready PR while the review is
  still pending.
- Codex review and fix agents default to bounded `medium` reasoning effort instead
  of inheriting an interactive session's potentially slow `xhigh`; set
  `GUARDEX_REVIEW_CODEX_EFFORT=low|medium|high|xhigh` to override it.
- `--review-model <name>` (or `GUARDEX_REVIEW_MODEL`) picks the review model, and
  `GUARDEX_REVIEW_CLAUDE_BIN` / `GUARDEX_REVIEW_CODEX_BIN` name the binary to run
  — useful when the provider's name on PATH resolves to a launcher whose startup
  is charged to every review round.

Two things the gate deliberately will NOT do, so do not expect them:

- **It never accepts a finding's disappearance as a fix.** A file that carried a
  blocking finding must either still be under review or have actually been edited
  by a repair round; otherwise the merge blocks. Review providers are
  nondeterministic, and a HIGH that simply fails to reappear is not a fixed HIGH.
- **It never lets the fixer grade its own work.** Every repair is judged by a
  separate review invocation.

Posting a review is NOT merging. `gx pr-review` / `gx review` post findings and
exit; only `gx branch finish` (or `gx ship`) merges. A PR sitting open with a
clean review means the finish flow was never run.

When an explicit task scaffold exists, its final section must end with PR merge + sandbox cleanup and record PR URL + final `MERGED` evidence. Routine work does not need a scaffold.

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

Keep the completion handoff to at most five short lines: outcome, files/behavior, verification, PR/merge/cleanup, and only material risk.

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

Report unresolved blockers concisely. Persist them in `openspec/plan/<plan-slug>/open-questions.md` only when that explicit plan workspace already exists.

### Optional companion tooling (use if installed)

- **fff MCP** (file search): prefer for all file search; fall back to `rtk grep`/`rtk find` or `rg`.
- **rtk** (shell compression): wrap noisy discovery (`rtk ls`/`grep`/`find`/`read`), git/gh (`rtk git status`/`gh pr list`), verification (`rtk tsc`/`lint`/`test`), and noisy gx reads (`rtk gx status`/`rtk gx doctor`). Do **not** wrap machine-readable commands (`--porcelain`, `--json`, exact stdout contracts) or shell-ready output (`gx prompt --exec`).
- **headroom** (context compression): when available, run large `gx` output, long logs, and big file/diff dumps through `headroom_compress` before reasoning over them (reversible — `headroom_retrieve` restores). Or set `GUARDEX_COMPRESS_CMD="<filter>"` so gx routes its own large narrative output — `gx prompt`, `gx prompt --snippet` — through your compressor (terse/non-TTY only, fail-open, JSON skipped; `--exec` stays raw). Keep PR URLs, branch names, and file paths visible; never compress `--json`/`--porcelain` or values you act on verbatim.
- **OpenSpec (opt-in)**: use it only for a user-requested or explicit T2/T3 workflow. When active, update checkpoints at meaningful milestones rather than after every tool call, then validate before archive.

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

If a change bumps a published version, the same PR records release notes in the repository's release-note mechanism. Do not create OpenSpec solely for a version bump, and do not edit `CHANGELOG.md` directly unless the repo explicitly requires it.

### What not to put in this file

No stale memory dumps, PR transcripts, long logs, generated status snapshots, session history, full OpenSpec examples, or duplicate workflow docs. This block is the hard contract — long examples and recovery docs live in repo-specific workflow files.
<!-- multiagent-safety:END -->
