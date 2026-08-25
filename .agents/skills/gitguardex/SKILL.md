---
name: gitguardex
description: "Repo guardrail check and repair."
---

Use when repo safety may be broken.

`gx status` -> `gx doctor` -> `gx status --strict`

Bootstrap: `gx setup`
Ops: `bash scripts/codex-agent.sh "<task>" "<agent>"`, `gx finish --all`, `gx cleanup`

## Finish checklist in Codex

Before `gx finish`, `gx ship`, or `gx branch finish`, show a Markdown checklist for Prepare, Preflight, PR, AI review, Autofix, CI, Merge, and Cleanup. Start the command with a short initial yield and poll the background process every 15-30 seconds. Update the checklist from `[gx:finish]` transition lines; during a quiet stage, show its name and elapsed time at most every 30 seconds. Never leave the user with only **Working** or **Waiting for background terminal**, never start a duplicate finish, and only check off stages backed by terminal evidence.
