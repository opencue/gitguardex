## Why

- Guardex currently documents OpenSpec tiers on `gx branch start`, but the start script still treated tier selection as a no-op and always behaved like the full scaffold path once auto-bootstrap was enabled.
- Codex launches also had no lightweight task-size gate, so tiny asks paid the full OMX/T3 setup cost even when the repo contract says those asks should stay caveman-only.
- Active session records did not preserve the routing decision, which made takeover prompts and the Active Agents surface blind to whether a sandbox was intentionally lightweight or OMX-backed.

## What Changes

- Wire real `T0`/`T1`/`T2`/`T3` behavior into `scripts/agent-branch-start.sh` and its template so auto-bootstrapped branch starts create the right OpenSpec footprint for the requested tier.
- Add a task-size decider to `scripts/codex-agent.sh` and its template so explicit lightweight asks route to caveman with `T1`, standard behavior changes route to OMX with `T2`, and orchestration-heavy asks escalate to `T3`.
- Persist `taskMode`, `openspecTier`, and `taskRoutingReason` in the active-session record schema and cover the new behavior with focused branch-start, sandbox, and session-state tests.

## Impact

- Affected surfaces are the Guardex branch bootstrap path, Codex launcher flow, and the VS Code Active Agents session metadata readers.
- Main risk is routing drift between the branch-start script, the Codex launcher, and the session schema; the targeted regression suite now exercises those surfaces together to keep them aligned.
- Existing default `gx branch start` behavior remains intact when `GUARDEX_OPENSPEC_AUTO_INIT=false`; tiered scaffolding only materializes on the same auto-bootstrap path Guardex already uses when OpenSpec initialization is enabled.
