# gx gap roadmap — 2026 Q2

Source conversation: 2026-05-11 session where the question "what is missing in gitguardex" surfaced seven distinct gaps. This document is the prioritized index. Each row links to a `gaps/NN-*.md` proposal seed that a future change can lift verbatim.

## Priority order

Priority ranks combine **user impact × implementation tractability × dependency depth**. P1 ships first.

| #  | Title                                                                | Tier | Effort | Priority | Deps   | One-line problem |
|----|----------------------------------------------------------------------|------|--------|----------|--------|------------------|
| 01 | [Interactive recovery verb](./gaps/01-interactive-recovery.md)        | T2   | ~6 files / ~1 day | P1 | none   | `agent-autofinish-watch.sh --auto-merge` is brave but blind; no `gx recover <branch>` that surfaces *why* a lane stalled. |
| 03 | [Stranded-lane inventory](./gaps/03-stranded-lane-inventory.md)       | T1   | ~3 files / ~half day | P1 | none   | `gx agents` shows lanes; no `--stranded` / `--age >Nm` filter despite 3 stranded codex lanes visible in attention-inbox right now. |
| 02 | [Structured observability](./gaps/02-structured-observability.md)     | T2   | ~10 files / ~1.5 days | P2 | none   | `gx agents --json` is hidden behind a subcommand; no append-only event log; planner UI cannot stream gx state. |
| 06 | [Per-remote trust policy](./gaps/06-per-remote-trust-policy.md)       | T1   | ~5 files / ~half day | P2 | none   | Codex approval policy is all-or-nothing per host; submodule pushes to trusted external remotes (e.g. `Webu-PRO/lifted.sk-storefront`) block every time. |
| 04 | [Conflict resolution verb](./gaps/04-conflict-resolution-verb.md)     | T2   | ~8 files / ~2 days | P3 | 02     | `submodule-pointer-conflict-resolver` worktree has been sitting idle; no `gx resolve` primitive — agents drop to raw git for the recurring submodule/lockfile/generated-file pattern. |
| 05 | [Cross-process lock enforcement](./gaps/05-cross-process-lock-enforcement.md) | T3 | multi-week | P4 | 02     | `gx locks claim` writes a manifest but nothing physically prevents an editor in another worktree from saving the file; pre-commit catches it, but late. |
| 07 | [`src/cli/main.js` refactor](./gaps/07-main-js-refactor.md)           | T3   | multi-week | P5 | 01, 03 | 125 KB file with hand-rolled `if (command === 'X')` cascade; next 3 features will keep growing it until it forks. Defer until at least one new verb has actually landed and pain is real. |

## Recommended sequencing

1. **Wave 1 (immediate, independent):** #01 Interactive recovery + #03 Stranded-lane filter. They wrap existing primitives, can ship in a single small PR if scoped together.
2. **Wave 2 (foundation for later gaps):** #02 Structured observability. Unlocks #04 and #05 by giving them an event stream and machine-readable lane data.
3. **Wave 3 (policy):** #06 Per-remote trust. Independent of #02; can run in parallel with Wave 2.
4. **Wave 4 (behavior):** #04 Conflict resolution. Needs design; do not rush.
5. **Wave 5 (defer):** #05 Lock enforcement and #07 main.js refactor are multi-week. Do not start until at least #01–#04 have shipped and pressure on the refactor is concrete.

## What is **not** on this roadmap

These were considered and intentionally excluded so future agents do not re-propose them:

- Adding more agent worktrees by default — the current 9-worktree pile is already too many; the answer is better recovery (#01) and lane hygiene, not more lanes.
- Replacing OpenSpec — change-driven workflow is working; gaps are in `gx` itself, not in the spec tool.
- Replacing Colony — coordination layer is out of scope for this repo.
- Renaming `multiagent-safety.js` to `gx.js` — cosmetic; not user-visible.

## Quota note

This roadmap was authored at 100 % weekly quota, so each gap doc deliberately stays short (< 100 lines) and front-loads the acceptance criteria so a fresh-quota session can read once and start implementing.
