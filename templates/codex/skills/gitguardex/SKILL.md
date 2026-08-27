---
name: gitguardex
description: "Use for GitGuardex branch/worktree safety, agent or subagent collision avoidance, file ownership, and gated PR finishing. Not for code-quality review."
---

Use when a GitGuardex-managed repository needs safe edits or multi-agent coordination.

`gx status` -> `gx doctor` -> `gx status --strict`

Bootstrap: `gx setup`
Ops: `gx branch start "<task>" "<agent>"`, `gx locks claim --branch "<agent-branch>" <file...>`, `gx branch finish --branch "<agent-branch>" --base <base> --via-pr --wait-for-merge --cleanup`, `gx finish --all`, `gx cleanup`

## Keep the default workflow lean

- Default to direct T1 work in code and tests. Do not create OpenSpec artifacts from task wording alone.
- OpenSpec is explicit opt-in: use `--tier T2` for a change workspace or `--tier T3` for change plus plan only when the user requests OpenSpec or the caller explicitly selects T2/T3.
- Treat the commit, targeted test output, and compact final handoff as the routine task record.

## Agent and subagent collaboration

Before parallel work, inspect the field with the MCP `list_agents` tool or the CLI fallback:

```sh
gx mcp list-agents --no-prs
```

For every file a writer may touch, check ownership, create an isolated lane, then claim it:

```sh
gx mcp who-owns path/to/file.ts
gx branch start "<bounded task>" "<agent>"
gx locks claim --branch "<agent-branch>" path/to/file.ts
```

- **One owner per file.** Split writer subagents by non-overlapping files or modules. Read-only scouts may share a surface; writers may not.
- Give each subagent one bounded objective and a verification command. Do not ask one subagent to explore, redesign, implement, and review the same slice.
- Re-check `list_agents` before expanding scope. If another lane owns or is already editing a file, coordinate a handoff or choose a different slice.
- Return a compact handoff: conclusion, `file:line`, changed files, verification result, and blocker or next action. Do not relay full logs.
- Finish each writing lane through its own PR once. Never run duplicate finish commands for the same branch.

The radar covers repositories visible to the current machine. On another machine with GitGuardex installed, use the same protocol against that machine's visible worktrees; do not assume local radar state is a cross-machine lock service.

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
