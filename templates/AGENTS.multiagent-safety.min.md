<!-- multiagent-safety:START -->
## Multi-Agent Safety (minimal)

Guardex is enabled by default. Disable via repo-root `.env` with `GUARDEX_ON=0`.

- Work from an `agent/*` branch + worktree — never edit the protected base (`main`/`dev`) directly. Start with `gx branch start "<task>" "<agent-name>"`, then `cd` into the printed worktree.
- Claim files before editing: `gx locks claim --branch "<agent-branch>" <file...>`.
- Finish completed work via PR + cleanup: `gx branch finish --branch "<agent-branch>" --via-pr --wait-for-merge --cleanup` (or `gx finish --all`).

Want the full multi-agent contract (Colony coordination, OpenSpec, token discipline, recovery)? Run `gx setup --contract`.
<!-- multiagent-safety:END -->
