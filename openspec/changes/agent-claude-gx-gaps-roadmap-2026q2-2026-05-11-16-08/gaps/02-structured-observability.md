# Gap 02 — Structured observability

## Problem

`gx` has no first-class machine-readable surface. `gx agents --json` does not work as a flat flag (`gx agents --json` returns `Unknown agents subcommand: --json` on the current `main` branch). There is no append-only event log of lane lifecycle events (`branch-start`, `lock-claim`, `commit`, `push`, `pr-open`, `merge`, `cleanup`, `stall-detected`). External tools — the Colony planner UI, cockpit, dashboards, scripts that want to watch CI — fall back to parsing human-readable text or scanning `.omc/agent-worktrees/` directly.

The cost shows up two places: planner cards do not refresh on real state changes, and stalled-lane recovery (Gap 01) has to re-derive history every time instead of reading an append-only stream.

## Evidence in current code

- `src/agents/status.js:86 buildAgentsStatusPayload()` already returns a structured `{ schemaVersion: 1, repoRoot, sessions: [...] }` payload — the data exists, just not exposed at the top-level CLI.
- `src/agents/status.js:110 renderAgentsStatus(payload, { json: true })` returns the JSON string; nothing calls it from `gx agents` directly.
- `src/cli/main.js:2692 function agents(rawArgs)` dispatches subcommands only.
- Repeated hand-grepping of `.omc/agent-worktrees/*/manifest.json` in `scripts/agent-autofinish-watch.sh` and `bin/agent-stalled-report.sh`.

## Proposed CLI surface

```bash
gx agents --json                            # flat surface; same payload as today's subcommand
gx status --json                            # repo-level health (delegates to scan + agents)
gx events tail [--since=15m] [--branch=...] # stream of NDJSON events
gx events log  [--last=100] [--branch=...]  # bounded historical query
```

Event log shape (NDJSON, one event per line, append-only file at `.omc/events.ndjson`):

```json
{"ts":"2026-05-11T16:08:00Z","kind":"branch-start","branch":"agent/claude/...","agent":"claude-opus","tier":"T2","worktree":".omc/agent-worktrees/..."}
{"ts":"2026-05-11T16:09:14Z","kind":"lock-claim","branch":"agent/claude/...","files":["proposal.md","tasks.md"]}
{"ts":"2026-05-11T16:30:02Z","kind":"pr-open","branch":"agent/claude/...","prUrl":"https://github.com/recodeee/gitguardex/pull/NNN"}
{"ts":"2026-05-11T16:35:11Z","kind":"merge","branch":"agent/claude/...","sha":"abc1234"}
```

Writer is the `gx branch start/finish`, `gx locks claim`, and the finish pipeline. Events file is gitignored by default and rotated by size in a follow-up.

## Tier / effort

- **Tier**: T2.
- **Effort**: ~10 files / ~1.5 days. New `src/events/index.js` (append/tail/log helpers) + integration calls from `start.js`, `finish/index.js`, `locks` writers + flat `--json` dispatch on `gx agents` and `gx status` + tests.

## Dependencies

None to ship. Unblocks Gap 04 (`gx resolve` reads the event log to detect repeated collisions) and Gap 05 (lock enforcement layer needs an audit trail anyway).

## Open questions

- Append-only file vs. SQLite? Lean **NDJSON**: zero deps, easy to tail in bash, easy to rotate.
- Per-repo only, or also a user-level `~/.gx/events.ndjson` aggregation? Start per-repo; user-level is a follow-up.
- Schema versioning: every event MUST include `schemaVersion: 1`. Bumps require an entry in `roadmap.md`.

## Acceptance criteria

- [ ] `gx agents --json` (flat) returns the same payload as the legacy subcommand, exits 0.
- [ ] `gx status --json` returns `{ schemaVersion, repoRoot, doctor: {...}, agents: {...} }`.
- [ ] `gx events tail` streams new events as they are written; `--since=15m` filters.
- [ ] `gx events log --last=100` returns the most recent N events in newest-first order.
- [ ] All write paths (`branch start`, `branch finish`, `locks claim/release`, `cleanup`) emit events.
- [ ] `.gitignore` updated to exclude `.omc/events.ndjson` and any rotated `.omc/events-*.ndjson`.
- [ ] Regression test: spawn a fixture branch, run the full lifecycle, assert event sequence.
