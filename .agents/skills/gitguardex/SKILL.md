---
name: gitguardex
description: "Repo guardrail check and repair."
---

Use when repo safety may be broken.

`gx status` -> `gx doctor` -> `gx status --strict`

Bootstrap: `gx setup`
Ops: `bash scripts/codex-agent.sh "<task>" "<agent>"`, `gx finish --all`, `gx cleanup`
