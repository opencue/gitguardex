# Gap 03 — Stranded-lane inventory (`gx agents --stranded`)

## Problem

The data needed to list "lanes that have not made progress in N minutes" already exists in `src/agents/status.js`. What is missing is a filter and an explicit "stranded" classification. Today, to find them, you either read the attention inbox (which is Colony state, not gx state), or you eyeball `git worktree list` and infer from commit ages.

Concrete present-tense pain: this session's attention inbox shows 3 stranded codex lanes (9 m, 14 m, 33 m old). The Claude session-start hook (`scripts/agent-stalled-report.sh`) surfaces them but does not let you query, sort, or feed them to another tool.

## Evidence in current code

- `src/agents/status.js:86 buildAgentsStatusPayload()` already returns per-session `activity`, `worktreeExists`, `changedFiles`, `lockCount`. None of these are exposed as filter knobs.
- `scripts/agent-autofinish-watch.sh` has its own ad-hoc "stranded" definition based on file-mtime silence — duplicated logic.
- `bin/agent-stalled-report.sh` is a one-shot wrapper that does not accept filters.
- `gx agents` (no args) prints "Agent sessions: none" in the primary checkout; the data is per-worktree but the listing is not.

## Proposed CLI surface

```bash
gx agents                            # existing behavior, unchanged
gx agents --stranded                 # only lanes whose last activity > 15m ago
gx agents --stranded --age=30m       # custom threshold
gx agents --stranded --json          # machine-readable for cockpit / planner
gx agents --owned-by claude-opus     # filter by agent (orthogonal to --stranded)
gx agents --tier T2                  # filter by tier
gx agents --no-pr                    # lanes with no PR URL yet
```

The "stranded" definition codifies what `agent-autofinish-watch.sh` already does:

- last mtime of any file inside the worktree > `--age` (default 15 m), AND
- no merged PR, AND
- `worktreeExists` is true.

## Tier / effort

- **Tier**: T1 (≤ 5 files, single capability, no API/schema change).
- **Effort**: ~3 files / ~half day. New filter helpers in `src/agents/status.js` + new `--stranded` / `--age` / `--owned-by` / `--tier` / `--no-pr` flag parsing in `src/cli/args.js` (or wherever `agents` parses its rest) + tests.

## Dependencies

None. Independently shippable. Pairs naturally with Gap 01 (`gx recover --all` would internally call this filter).

## Open questions

- Default `--age` threshold: 15 m (matches `agent-autofinish-watch.sh --idle-seconds=900`) or shorter (5 m) for tighter feedback? Lean **15 m** to match existing semantics.
- Should `--stranded` exit non-zero when one or more lanes are stranded? Lean **yes**, so it composes into CI / shell pipelines (`gx agents --stranded || gx recover --all`).

## Acceptance criteria

- [ ] `gx agents --stranded` lists only lanes meeting the stranded criterion; empty output and exit 0 when none.
- [ ] `gx agents --stranded --json` returns the filtered payload with the same schema as the unfiltered `--json`.
- [ ] `--age=<duration>` accepts `Ns`, `Nm`, `Nh` and rejects invalid input with a clear error.
- [ ] `--owned-by`, `--tier`, `--no-pr` compose with `--stranded` via logical AND.
- [ ] `--stranded` exits non-zero (e.g. exit 2) when at least one stranded lane is found, so it works in shell guards.
- [ ] Regression test fixtures: zero lanes, one stranded lane, one active lane, mixed.
