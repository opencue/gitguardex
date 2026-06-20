# Release: @imdeadpool/guardex 7.1.0 — Cross-repo agent coordination

Version bump 7.0.43 -> 7.1.0 (minor; new `gx mcp` feature + behavior-default
changes, all backward-compatible / overridable). Cuts a release covering PRs
#626-#633.

## Why minor
Multiple `feat:` additions since the last tag (v7.0.42): the `gx mcp` agent
radar, `gx claude install` MCP auto-registration, the any-non-protected-branch
policy, and the T1 default tier. No removals; every default change is overridable.

## Included (since v7.0.42)
- feat: any non-protected branch is agent-managed (#626)
- perf: protected-branch advisor dedup + guard-message consistency (#627)
- feat: `gx mcp` cross-repo read-only agent radar (#628)
- feat: `gx claude install` auto-registers the gx MCP server in `.mcp.json` (#629)
- perf/feat: batch PR lookups, PRs on by default in list_agents (#630)
- perf: preflight quiet by default + fix single-failing-step false pass (#631)
- feat: default `gx branch start` tier T1, not T3 (#632)
- feat: gx mcp stale-lane detection + pr_lookup_error field (#633)

## Release mechanics
Manual bump + manual `npm publish` this cycle (bypasses release-please for this
release). GitHub release `v7.1.0` published with full English notes.
