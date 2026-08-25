---
name: gitguardex
description: "Repo guardrail check and repair."
---

Use when repo safety may be broken.

`gx status` -> `gx doctor` -> `gx status --strict`

Bootstrap: `gx setup`
Ops: `gx branch start "<task>" "<agent>"`, `gx locks claim --branch "<agent-branch>" <file...>`, `gx branch finish --branch "<agent-branch>" --base <base> --via-pr --wait-for-merge --cleanup`, `gx finish --all`, `gx cleanup`

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

When inspecting or verifying, prefer `rtk` compact wrappers if available (`rtk git status`, `rtk grep`, `rtk test <cmd>`, and noisy gx reads like `rtk gx status` / `rtk gx doctor`). Do not wrap commands whose stdout is parsed by scripts (`--json`, `--porcelain`, exact stdout contracts) or shell-ready output (`gx prompt --exec`).

To shrink gx's own large narrative output (e.g. `gx prompt`, `gx prompt --snippet`) before it lands in your context, set `GUARDEX_COMPRESS_CMD="<stdin->stdout filter>"`; gx routes that output through the filter (terse/non-TTY mode, fail-open, JSON skipped). Unset = byte-for-byte unchanged. Confirm it is wired with `gx status` or `gx doctor` — both print a `Token compression` line and flag a configured-but-missing binary (doctor's warning is advisory and never changes its safe/unsafe exit code).
