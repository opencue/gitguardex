## Why

- Guardex-launched Codex sessions still prompt for approval in the middle of agent work.
- The intended default is durable approval-free execution for Guardex Codex lanes without requiring a per-session `codex -a never` wrapper.

## What Changes

- `scripts/codex-agent.sh` injects `-a never` into Codex CLI launches by default.
- Explicit caller approval flags still win, and `GUARDEX_CODEX_APPROVAL_POLICY` can override or disable the injected policy.
- Conflict-review Codex relaunches use the same approval policy behavior.
- Focused sandbox tests cover the default and explicit override paths.

## Impact

- Affects only Guardex Codex launcher sessions.
- Keeps the Codex filesystem/network sandbox unchanged; this removes approval prompts, not sandboxing.
- The local `scripts/codex-agent.sh` symlink and managed template share the same implementation.
