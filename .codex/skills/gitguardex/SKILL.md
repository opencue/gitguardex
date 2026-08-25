---
name: gitguardex
description: "Repo guardrail check and repair."
---

Use when repo safety may be broken.

`gx status` -> `gx doctor` -> `gx status --strict`

Bootstrap: `gx setup`
Ops: `bash scripts/codex-agent.sh "<task>" "<agent>"`, `gx finish --all`, `gx cleanup`

## Finish checklist in Codex

Before `gx finish`, `gx ship`, or `gx branch finish`, show a compact `### 🚀 GX Finish · N/8` card with branch → base, active stage, elapsed time, and an emoji checklist for Prepare, Preflight, PR, AI review, Autofix, CI, Merge, and Cleanup. Start with a short initial yield and poll every 15-30 seconds. Update from `[gx:finish]` transitions or the private `.omx/state/finish-runs/*.jsonl` stream; during a quiet stage, refresh its name and elapsed time at most every 30 seconds. Never leave only **Working** or **Waiting for background terminal**, never start a duplicate finish, and only check off stages backed by terminal evidence. Keep `🏁 Cleanup` neutral because cleanup is best-effort; surface warnings instead of showing `✅` unconditionally.
