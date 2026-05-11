# Gap 07 — `src/cli/main.js` refactor

## Problem

`src/cli/main.js` is 125 KB. It contains a hand-rolled `if (command === 'X') return Y(rest)` cascade for every top-level subcommand, alongside dozens of helper functions, constants imports, and command implementations co-located in the same file. Adding any new top-level verb (`gx recover`, `gx events`, `gx resolve`, `gx config`) bolts more lines onto the same dispatch.

This is not yet broken — but the next 3 features from this roadmap (#01 recover, #02 events, #04 resolve, #06 config trust) each add a dispatch entry plus inline glue plus arg-parsing. Without intervention, `main.js` will cross 150 KB this quarter and become the single biggest review bottleneck.

## Evidence in current code

- `src/cli/main.js` size: ~125 KB (memory 4815, confirmed via `ls -la` in this session).
- Dispatch lines `src/cli/main.js:3911–3971` form a flat `if (command === '...')` chain with no extensibility hook.
- `src/cli/args.js` is 31 KB and parses every command's args by hand; same growth pattern.
- Existing partial extraction: `src/cli/dispatch.js` exists at only 2 KB — the seed for a registry is there but unused at the top level.

## Proposed approach

This is a refactor, not a feature. The proposed sequence:

1. Introduce a `CommandRegistry` in `src/cli/dispatch.js` (already a 2 KB seed file).
2. Each top-level verb registers itself: `registry.register({ name, aliases, help, parseArgs, run })`.
3. Move one verb at a time out of `main.js` into its own module under `src/cli/commands/<verb>.js`.
4. Migration order, smallest-risk-first: `version`, `prompt`, `pr-review`, `protect`, `sync`, `release`, `report`, `migrate`, `pivot`, `ship`, `hook`, `install-agent-skills`, `worktree`, `merge`, `cleanup`, `agents`, `cockpit`, `submodule`, `locks`, `doctor`, `branch`, `finish`, `setup`/`install`/`fix`/`scan`/`status` (the cluster). Each migration is its own PR with regression coverage.
5. Final `main.js` becomes ~5 KB: import the registry, dispatch, top-level error handling.

## Tier / effort

- **Tier**: T3 (cross-cutting, multi-PR).
- **Effort**: multi-week. ~1 PR per verb migration; ~25 verbs visible in the current cascade. Each PR small (one verb), but the total span is significant.

## Dependencies

- **Hard on Gap 01** (`gx recover`) and **Gap 03** (`--stranded` filter) shipping first. Reasoning: those two PRs prove the existing dispatch is still expressive enough; only after they land do we know whether the registry refactor is needed or premature.
- **Hard on stable test coverage**. The refactor must not regress any verb. Either snapshot tests for every CLI surface, or a comprehensive integration-test suite, must exist before starting verb migration PR #1.

## Why this is deferred (loudly)

`main.js` being 125 KB is a smell, not yet a bug. The refactor:

- Is the second-most likely thing to introduce regressions in `gx` itself.
- Provides zero new user value (no new verb, no new flag, no new safety).
- Locks the repo into review-heavy PRs for weeks.

Do **not** start this refactor until:

1. At least 3 of the other 6 gaps have shipped, **and**
2. The pain of bolting on the next feature has been concretely felt by an agent (PR comment, blocker handoff, or readability complaint), **not** anticipated.

If neither condition holds, this gap stays open as documentation, not as a backlog item.

## Acceptance criteria (only meaningful once kicked off)

- [ ] ADR written justifying the registry pattern and the chosen migration order.
- [ ] `src/cli/dispatch.js` exposes a `CommandRegistry` API.
- [ ] First verb migration PR (smallest verb) is reviewable in < 200 LOC of diff.
- [ ] Regression test asserts every pre-refactor verb still works identically post-refactor (snapshot of help text + a smoke invocation per verb).
- [ ] No public surface change visible to users between refactor PRs.
- [ ] Final `main.js` (post-migration) is < 10 KB.

## Caveat

The 125 KB number is a measurement, not a target. If `main.js` shrinks for organic reasons (verbs that get extracted as part of feature work), this gap may close itself without a dedicated refactor sprint. Re-evaluate before starting.
