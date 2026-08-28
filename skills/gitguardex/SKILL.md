---
name: gitguardex
description: "Use for GitGuardex branch/worktree safety, agent or subagent collision avoidance, file ownership, and gated PR finishing. Not for code-quality review."
---

Use when a GitGuardex-managed repository needs safe edits or multi-agent coordination.

`gx status` -> `gx doctor` -> `gx status --strict`

Bootstrap: `gx setup`
Ops: `gx branch start "<task>" "<agent>"`, `gx locks claim --branch "<agent-branch>" <file...>`, `gx branch finish --branch "<agent-branch>" --base <base> --via-pr --wait-for-merge --cleanup`, `gx finish --all`, `gx cleanup`

## Choose the lane before editing

Worktree policy is strict `always` unless the repo opts into `adaptive` with
`GUARDEX_WORKTREE_MODE=adaptive` in `.env` or
`git config --local multiagent.worktreeMode adaptive`.

1. Run `gx status`. In adaptive mode, also inspect `list_agents` (or
   `gx mcp list-agents --no-prs`), the current dirty paths, and `who_owns` for
   every intended file.
2. Stay on the current checkout only for bounded, single-agent work with no
   competing writer, claimed target, or dirty-path overlap.
3. Pivot to a new isolated lane when the task is substantial/long-lived,
   another writer is active in the repo, a target is owned or dirty elsewhere,
   or the scope expands. Use
   `gx branch start --new --no-transfer "<bounded task>" "<agent>"`.
4. Re-run the radar before expanding scope. Never overwrite another lane's
   changes. If direct work already has edits when a pivot becomes necessary,
   transfer only those known edits deliberately; do not absorb unrelated files.

Direct adaptive work uses ordinary repo commit/push commands. Isolated work uses
claims and the gated `gx branch finish` flow below.

## Keep the default workflow lean

- Default to direct T1 work in code and tests. Do not create OpenSpec artifacts from task wording alone.
- OpenSpec is explicit opt-in: use `--tier T2` for a change workspace or `--tier T3` for change plus plan only when the user requests OpenSpec or the caller explicitly selects T2/T3.
- Treat the commit, targeted test output, and compact final handoff as the routine task record.

## Agent and subagent collaboration

Before parallel work, inspect the field with the MCP `list_agents` tool or the CLI fallback:

```sh
gx mcp list-agents --no-prs
```

For every file a parallel writer may touch, check ownership, create an isolated lane, then claim it:

```sh
gx mcp who-owns path/to/file.ts
gx branch start --new --no-transfer "<bounded task>" "<agent>"
gx locks claim --branch "<agent-branch>" path/to/file.ts
```

- **One owner per file.** Split writer subagents by non-overlapping files or modules. Read-only scouts may share a surface; writers may not.
- Give each subagent one bounded objective and a verification command. Do not ask one subagent to explore, redesign, implement, and review the same slice.
- Re-check `list_agents` before expanding scope. If another lane owns or is already editing a file, coordinate a handoff or choose a different slice.
- Return a compact handoff: conclusion, `file:line`, changed files, verification result, and blocker or next action. Do not relay full logs.
- Finish each writing lane through its own PR once. Never run duplicate finish commands for the same branch.

## Optional cross-machine Git lock and radar state

Local worktree locks remain the default. When agents on multiple machines use the same writable Git remote, opt into shared state per repository:

```sh
gx locks shared-enable --remote origin
gx locks shared-status
```

After enablement, ordinary `claim`, `allow-delete`, `validate`, `release`, and `status` commands also use atomic remote refs under `refs/gitguardex/locks/*`. `gx mcp list-agents` combines local worktrees with remote `agent/*` branches and shared lock owners; `gx mcp who-owns` resolves the same shared owner data.

- Shared mode is explicit and fail-closed: if the remote is unreachable, rejects custom refs, or returns invalid metadata, do not keep a local-only claim or approve a commit.
- The remote must allow authenticated custom-ref creation, compare-and-swap updates, and deletion. GitGuardex stores validated JSON metadata in commits; it never executes remote metadata, and publishes only a hashed machine identifier.
- Push the agent branch when full remote-lane visibility matters. A lock still makes an unpushed branch visible as a lock-owning remote lane.
- Release locks before disabling shared state or abandoning a lane. Cross-machine locks are not automatically reaped because one host cannot safely prove that another host's process is dead.
- `gx locks shared-disable` stops shared reads and writes for this repository; it does not delete remote refs owned by any machine.

## Finish checklist in Codex

Before starting a long `gx finish`, `gx ship`, or `gx branch finish`, show this compact Markdown checklist in commentary and update it from the CLI's `[gx:finish]` transition lines:

- [ ] Prepare branch
- [ ] Local preflight
- [ ] Push and open PR
- [ ] AI review
- [ ] Review autofix
- [ ] CI checks
- [ ] Merge
- [ ] Cleanup

Render each state-change update as a compact card, not as a raw log dump:

### 🚀 GX Finish · `3/8`
`agent/...` → `main` · 🔄 **AI review** · `00:44`

- ✅ Prepare branch
- ✅ Local preflight
- ✅ Push and open PR · `#123`
- 🔄 AI review
- ⬜ Review autofix
- ⬜ CI checks
- ⬜ Merge
- ⬜ Cleanup

Start the command with a short initial yield, then poll the background process every 15-30 seconds. Between polls, post an updated checklist when the active stage changes; during a quiet long stage, name the active stage and elapsed time at most every 30 seconds. Never leave the user with only Codex's generic **Working** or **Waiting for background terminal** label. Do not launch a duplicate finish while the first process is still alive, and do not mark a checkbox complete until a matching `✓` line or equivalent terminal evidence arrives.

Treat `🏁 Cleanup` as finished-but-best-effort, not as unconditional success: surface any cleanup warnings beside it instead of converting it to `✅`.

Structured phase events are persisted privately under `.omx/state/finish-runs/*.jsonl` (`0700` directory, `0600` files). Prefer that JSONL stream over parsing narrative logs when exact state is needed; the visual output prints the active event-file path.

When inspecting or verifying, prefer `rtk` compact wrappers if available (`rtk git status`, `rtk grep`, `rtk test <cmd>`, and noisy gx reads like `rtk gx status` / `rtk gx doctor`). Do not wrap commands whose stdout is parsed by scripts (`--json`, `--porcelain`, exact stdout contracts) or shell-ready output (`gx prompt --exec`).

To shrink gx's own large narrative output (e.g. `gx prompt`, `gx prompt --snippet`) before it lands in your context, set `GUARDEX_COMPRESS_CMD="<stdin->stdout filter>"`; gx routes that output through the filter (terse/non-TTY mode, fail-open, JSON skipped). Unset = byte-for-byte unchanged. Confirm it is wired with `gx status` or `gx doctor` — both print a `Token compression` line and flag a configured-but-missing binary (doctor's warning is advisory and never changes its safe/unsafe exit code).
