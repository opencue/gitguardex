# Gap 01 — Interactive recovery verb (`gx recover`)

## Problem

When an agent lane stalls, the current answer is `scripts/agent-autofinish-watch.sh --auto-merge`, which after 15 minutes of file silence commits whatever is in the worktree, pushes, and tries to merge. That is a daemon for the *common* case (idle worktree, clean intent). It is the wrong tool when the lane is actually broken: dirty submodule, missing lock claim, unmerged PR check failures, raced base-branch push, or a half-applied edit the agent meant to revert.

There is no command that lets a human (or a fresh agent) ask: "this branch is stuck — tell me *why*, and propose the narrow fix."

## Evidence in current code

- `scripts/agent-autofinish-watch.sh` (commit-then-push pipeline, idle-driven).
- `bin/agent-stalled-report.sh` (wired as `SessionStart` hook — emits one-line summary per stalled branch).
- `src/agents/status.js` already builds rich `Session` records via `buildAgentsStatusPayload(repoRoot)` including `worktreeExists`, `lockCount`, `claimedFiles`, `changedFiles`, `prUrl`, `prState`.
- Attention inbox at session start: 3 codex lanes stalled at 9 m, 14 m, 33 m old — recurring real-world signal.

## Proposed CLI surface

```bash
gx recover <branch>                  # diagnostic mode: print causes, no actions
gx recover <branch> --apply          # take the safest single recommended action
gx recover <branch> --dry-run        # equivalent to bare invocation (default)
gx recover --all                     # diagnose every stranded branch
gx recover <branch> --json           # machine-readable for cockpit / dashboard
```

Diagnostic output buckets the lane into one of:

- `clean-idle`        → recommend `gx branch finish ... --via-pr --wait-for-merge --cleanup`.
- `dirty-uncommitted` → recommend `git -C <wt> commit -am "wip recover"` then finish.
- `unclaimed-files`   → list the unclaimed paths, recommend `gx locks claim ...`.
- `submodule-pointer-drift` → recommend `gx submodule advance` inside the worktree.
- `pr-open-checks-red` → link the PR + failing check name.
- `worktree-missing` → recommend `git worktree prune` + branch deletion if no commits exist.
- `unknown` → dump the raw evidence and STOP (do not auto-apply).

## Tier / effort

- **Tier**: T2.
- **Effort**: ~6 files / ~1 day. New `src/recover/index.js` + dispatch entry in `src/cli/main.js` + arg parsing in `src/cli/args.js` + tests + manifest entry. Reuses `agents/status.js`, `git/index.js`, and `submoduleModule` primitives.

## Dependencies

None. Ships independently. Pairs well with Gap 03 (stranded filter) but does not depend on it.

## Open questions

- Should `gx recover --apply` run the finish pipeline directly, or print the exact command and let the user/agent paste? Lean **print**, since the recovery verb is meant to be diagnostic-first.
- Should it touch other agents' lanes (`--all`)? Probably yes, but with `--apply` refusing to act on lanes whose lock owner is not the current user/agent.
- Where do we surface unmerged-PR check failures? Likely via `gh pr checks` shell-out, gated on `gh` presence.

## Acceptance criteria

- [ ] `gx recover <branch>` exits 0 with a human-readable diagnosis for every state in the bucket list.
- [ ] `gx recover <branch> --json` returns `{ branch, state, evidence: {...}, recommended: { command: "...", reason: "..." } }`.
- [ ] `gx recover --all` iterates every `agent/*` branch (current-user-owned) and prints one diagnosis per lane.
- [ ] `--apply` performs the recommended action only for the `clean-idle`, `dirty-uncommitted`, and `unclaimed-files` states; refuses on the rest with an explanation.
- [ ] Regression test covers each bucket against a fixture worktree.
