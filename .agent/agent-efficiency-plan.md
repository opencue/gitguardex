# Agent efficiency implementation

Baseline: 1f05ca4. Scope: preserve all finish gates and public defaults; improve
opt-in quiet output, expose bounded incremental finish observations, and parallelize
read-only watch probes. No dependency, release, global configuration or lock-policy changes.

## Sequence and acceptance

- [x] Lock output/gate decisions with fixture tests; measure bytes separately from tokens.
- [x] Honor agentQuiet in the review gate, retaining warnings/errors and original verdicts.
- [x] Read finish JSONL incrementally through an opt-in CLI with a run-bound cursor,
      bounded waiting, partial-line handling and fail-closed file validation.
- [x] Collect watch rows with at most four concurrent read-only probes, stable order,
      no overlapping refreshes and explicit unknown PR state.
- [x] Add a repeatable local benchmark and synchronized agent usage instructions.
- [x] Run final formatting, lint, coverage and packaging checks.
- [ ] Finish this lane through the required gated PR flow.

## Decisions

- The worktree starts from newer origin/main (1f05ca4), not the earlier local analysis SHA.
- Existing shell preflight already supports a cached pass. Do not add a second cache
  without evidence of redundant checks on identical trusted inputs.
- Keep existing prompt slices; document their use rather than rewriting global Cue/OMX
  instructions or changing the default prompt's safety contract.
- Local fixture byte/timing measurements are not LLM token savings or a model A/B eval.
- Observed event state is never authority for merge, cleanup or verification.

## Verification / outcomes

- Targeted behavior suite: 51 passed. Follow-up metadata/event integration suite:
  37 passed after restoring the thin CLI wrapper and syncing the shipped skill.
- Format, lint and package checks passed. Full coverage rerun passed:
  1294 passing tests, one skipped, zero failures; lines 70.84%, branches 75.29%,
  functions 75.52%, above the repository's enforced thresholds.
- Real local CLI smoke: `watch --once` succeeds. A child-process regression verifies
  non-overlapping refreshes and cancellation of the active GitHub probe on SIGINT.
- `node scripts/benchmark-agent-flow.js` runs 10 rotated paired fixture rounds:
  gate narration is 318 to 0 bytes for success, 452 to 0 for autofix, with identical
  verdicts, event sequences and dependency calls. These are gate narration bytes,
  not the total CLI transcript; errors are propagated rather than counted as logs.
- With simulated 10 ms GitHub probes, 20-row watch median was 219.31 ms serial
  versus 53.23 ms bounded (p95: 224.84 versus 61.36 ms). This does not establish
  real network speedup. One-row medians were 10.98 versus 10.65 ms.
- Provider token counts and agent tool turns remain unmeasured. A same-model,
  repeated task-level A/B evaluation is still required before a token-savings claim.
