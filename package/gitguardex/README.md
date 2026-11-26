# GitGuardex

GitGuardex coordinates isolated agent worktrees, file ownership, verification
and PR-only merges.

```sh
npm install -g @imdeadpool/guardex
gx --help
```

See the [project README](https://github.com/opencue/gitguardex#readme) for setup
and workflows, and the [repository](https://github.com/opencue/gitguardex)
for source and contributing information.

## Agent handoffs

- Request a contested file with `gx locks handoff-request -- <path>`. The owner
  sees it in `gx agents inbox`, or can run `gx locks handoffs --mine` without a
  registered agent session. The request stays visible across session restarts
  while the original lock is current.
- From the owner worktree, `gx locks handoff-ack <id>` marks the request as seen.
  Only `gx locks handoff-approve <id>` can transfer the lock. These commands
  are for local worktrees, not shared Git locks.
- Send a merge-ready signal with
  `gx agents send --session <id> --pr 123 --merge-ready --message "Verified locally; please check the gates"`.
  It is a sender's advisory for the observed head of an open, non-draft PR,
  not a passing review or a merge command.

## Upstream projects

These GitHub star badges update automatically. The coordination references
inspire GitGuardex's native implementation; they are not required dependencies.

| Project | GitHub stars | What GitGuardex uses |
| --- | --- | --- |
| [Coordinaut](https://github.com/LevDomasnih/coordinaut) | [![Coordinaut stars](https://img.shields.io/github/stars/LevDomasnih/coordinaut?style=flat)](https://github.com/LevDomasnih/coordinaut/stargazers) | Inspiration: show pending file handoffs in the owner's inbox. |
| [MCP Agent Mail](https://github.com/Dicklesworthstone/mcp_agent_mail_rust) | [![MCP Agent Mail stars](https://img.shields.io/github/stars/Dicklesworthstone/mcp_agent_mail_rust?style=flat)](https://github.com/Dicklesworthstone/mcp_agent_mail_rust/stargazers) | Inspiration: acknowledge receipt separately from transferring ownership. |
| [Gas Town](https://github.com/gastownhall/gastown) | [![Gas Town stars](https://img.shields.io/github/stars/gastownhall/gastown?style=flat)](https://github.com/gastownhall/gastown/stargazers) | Inspiration: a typed merge-ready signal, without importing its merge queue. |
| [BugHunter](https://github.com/codexstar69/bug-hunter) | [![BugHunter stars](https://img.shields.io/github/stars/codexstar69/bug-hunter?style=flat)](https://github.com/codexstar69/bug-hunter/stargazers) | Adapted approach for an optional, diff-only advisory bug pass. |
| [Worktrunk](https://github.com/max-sixty/worktrunk) | [![Worktrunk stars](https://img.shields.io/github/stars/max-sixty/worktrunk?style=flat)](https://github.com/max-sixty/worktrunk/stargazers) | Adapted worktree navigation, lifecycle hooks, and ignored-file selection. |
| [abide](https://github.com/coldteadotai/abide) | [![abide stars](https://img.shields.io/github/stars/coldteadotai/abide?style=flat)](https://github.com/coldteadotai/abide/stargazers) | Optional integration: checks changes against repository instructions. |
| [ccusage](https://github.com/ccusage/ccusage) | [![ccusage stars](https://img.shields.io/github/stars/ccusage/ccusage?style=flat)](https://github.com/ccusage/ccusage/stargazers) | Optional backend for reading local usage logs via `gx usage`. |

## Release notes

See the [GitHub releases](https://github.com/opencue/gitguardex/releases).
