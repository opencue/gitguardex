## Why

Seven distinct gaps in gitguardex (`gx`) surfaced during a session-level conversation on 2026-05-11. Each is large enough to deserve its own future change, but small enough to ship independently. Without a written backlog, they will either be forgotten or get re-discovered next session at full cost.

The roadmap converts the conversation into a reviewable, prioritized list of future changes so the user can:

- See all 7 gaps in one place with tier (`T1`/`T2`/`T3`), effort, dependencies, and current state of the world.
- Skim each gap's `gaps/NN-*.md` and decide which to fund next session (or hand off).
- Reuse the gap docs as the proposal seed for a real T1/T2 change when work starts.

## What Changes

This change is **documentation-only** and ships no source code or CLI surface changes.

It adds:

- `roadmap.md` — priority-sorted index of all 7 gaps with one-line summary per row.
- `gaps/01-interactive-recovery.md`
- `gaps/02-structured-observability.md`
- `gaps/03-stranded-lane-inventory.md`
- `gaps/04-conflict-resolution-verb.md`
- `gaps/05-cross-process-lock-enforcement.md`
- `gaps/06-per-remote-trust-policy.md`
- `gaps/07-main-js-refactor.md`

Each gap doc uses a consistent template (problem, evidence in current code, proposed CLI surface, tier, effort, dependencies, open questions, acceptance criteria) so it can drop straight into a future change's `proposal.md` with minimal rewrite.

## Impact

- **Surfaces affected**: `openspec/changes/` only. No `src/`, no `scripts/`, no `bin/`, no `.claude/`, no package version bump.
- **Risk**: zero behavioral risk. Docs do not execute.
- **Rollout**: merge to `main` immediately; gaps become candidate proposals for future agent sessions.
- **Follow-ups**: each gap doc lists its own dependencies. Gaps #1, #3, #6 are independently shippable; gaps #4 and #5 depend on #2 (structured observability) for evidence. Gap #7 (refactor) should be deferred until at least one of the new verbs lands and pressure on `main.js` is real.
- **Not done here**: no source code, no tests, no `tasks.md` for the future gaps — those each get a fresh change folder when their work starts.
