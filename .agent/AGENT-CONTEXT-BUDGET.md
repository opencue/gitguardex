# Agent Context Budget

This repository manages multi-agent safety, worktrees, locks, hooks, and
runtime state. Those are exactly the files that can explode agent context when
read directly. Keep injected instructions lean and open detailed workflow docs
only when needed.

## Always-Injected Contract

`AGENTS.md` and `CLAUDE.md` are the same contract (`CLAUDE.md` is a symlink).
Keep that file limited to:

- objective
- non-negotiable safety rules
- minimum branch/worktree/lock/finish commands
- pointers to `.agent/*` docs
- context traps

Move long examples, recovery manuals, command catalogs, and generated status
snapshots into `.agent/` docs.

## Files To Avoid Loading By Default

- `.omc/logs/*`
- `.omc/state/*`
- `.omx/logs/*`
- `.omx/state/*`
- `.claude/worktrees/*`
- nested `target/`, `node_modules/`, lockfiles, and generated build output
- `*.jsonl`, `*.ndjson`, and large captured logs

If one is required, check size with `wc -c` or `du -h` first, then sample with a
narrow `rg`, `head`, `tail`, or `sed -n`.

## Permanent Repo Rules

- Do not commit local runtime state.
- Do not paste full hook logs or agent transcripts into specs, PRs, or
  handoffs.
- Use compact handoffs: branch, task, blocker, next, evidence.
- Prefer `gx branch finish --via-pr --wait-for-merge --cleanup` so PR and
  worktree cleanup stay coupled.

## Current Blocker

If `AGENTS.md` needs to be slimmed further, first clear the lock owned by the
active lane that currently owns the file. Do not bypass a lock on this repo's
own contract file.
