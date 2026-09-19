# Bounded agent observations — execution plan

Outcome: implement the researched P0–P4 patterns without changing merge, lock,
liveness or default CLI/MCP contracts. External projects inspire patterns only;
no foreign source, dependency, daemon, AST index or authority cache is introduced.

1. P0: baseline targeted tests (62 passing); extend deterministic paired fixtures.
2. P1: opt-in UTF-8 `max_bytes` context projection. Ownership and safety fields
   are mandatory; insufficient budgets fail explicitly, never imply no conflict.
3. P2: opt-in watch PR cache, full-HEAD/remote/repository key and single-flight;
   dirty state stays live, unknown results are not cached, cancellation is scoped.
4. P3: opt-in finish `--view state`: bounded snapshot pages and changed stages,
   resumable file-identity cursor; retain warning/error records and raw default.
5. P4: opt-in activity surface deduplication; persist successful identity only,
   retain every heartbeat update and retry failures/changed targets.

Acceptance: focused regression tests per surface, deterministic benchmark with
JSON bytes, timings and fixture call counts; then repository format/lint,
coverage and package gates. Real provider-token savings remain unmeasured.
Ship through the repository's gated PR finish, never bypass a blocked gate.

Research: `../gitguardex-research/2026-09-19/IMPLEMENTATION-PLAN.hu.md` (from
the primary checkout's parent). Worktrunk TTL/HEAD keys, Superset single-flight,
Vibe Kanban snapshots, Aider budgets, Claude Squad surface deduplication.

## Implementation and evidence

- Implemented all four opt-in runtime surfaces; cache integration is restricted
  to watch (MCP and merge gates remain uncached).
- P1 preserves the complete self-context and ownership block; only peer summaries
  are budgeted. P3 snapshot pages are keyed patches rather than a single unbounded
  snapshot; consumers accumulate pages until `snapshotComplete`.
- P4 stores successful label receipts in existing session metadata, so repeated
  CLI processes benefit without losing activity/updatedAt writes.
- Delivery: one cohesive PR with phase-scoped commits, instead of four separate
  CI/review cycles. Each mode is independently opt-in; no rollout default changes.
- Focused regression suite: 72 passed. Full coverage run: 1329 passed, 4 skipped,
  0 failed; lines 71.05%, branches 75.72%, functions 75.90%. Lint, changed-format,
  package dry-run and whitespace checks passed. Gated finish reruns delivery checks.
- `node scripts/benchmark-agent-flow.js`: 20 peers/200 requested files produced
  58,830 raw vs 17,610 bounded JSON bytes with identical ownership. 20-lane,
  three-refresh fixtures (including changed HEAD) used 60 vs 40 PR probes and
  60 dirty reads in both modes. 1,000 identical activity events produced 1,000
  vs 1 surface writes and retained all 1,000 activity updates.
- 10,000-event fixture: raw 910,536 vs state 1,847 total response bytes. State
  projection costs additional CPU: this run was ~32ms vs ~14ms raw; surface
  deduplication also costs more CPU when the surface writer is a no-op. These are
  output/fixture-call reductions, not evidence of end-to-end or LLM-token savings.
- Limitations: actual provider tokens, live GitHub latency, actual git/gh process
  counts and peak RSS remain unmeasured. The benchmark labels mocked counters,
  simulated latency and sampled heap explicitly. Real same-model paired agent
  evaluations are a follow-up, not a claimed improvement.

## Next step

Complete the repository's gated PR finish. After shipping, optionally run the
same-model paired agent evaluation before advertising token or total-time gains.
