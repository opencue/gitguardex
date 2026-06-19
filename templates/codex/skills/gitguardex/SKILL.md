---
name: gitguardex
description: "Repo guardrail check and repair."
---

Use when repo safety may be broken.

`gx status` -> `gx doctor` -> `gx status --strict`

Bootstrap: `gx setup`
Ops: `gx branch start "<task>" "<agent>"`, `gx locks claim --branch "<agent-branch>" <file...>`, `gx branch finish --branch "<agent-branch>" --base <base> --via-pr --wait-for-merge --cleanup`, `gx finish --all`, `gx cleanup`

When inspecting or verifying, prefer `rtk` compact wrappers if available (`rtk git status`, `rtk grep`, `rtk test <cmd>`, and noisy gx reads like `rtk gx status` / `rtk gx doctor`). Do not wrap commands whose stdout is parsed by scripts (`--json`, `--porcelain`, exact stdout contracts) or shell-ready output (`gx prompt --exec`).

To shrink gx's own large narrative output (e.g. `gx prompt`, `gx prompt --snippet`) before it lands in your context, set `GUARDEX_COMPRESS_CMD="<stdin->stdout filter>"`; gx routes that output through the filter (terse/non-TTY mode, fail-open, JSON skipped). Unset = byte-for-byte unchanged.
