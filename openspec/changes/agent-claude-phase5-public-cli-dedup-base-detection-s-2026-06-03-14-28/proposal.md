## Why

- After #618 landed the canonical `detectDefaultBaseBranch` in `src/git/index.js`, `src/pr.js` still carried its own drifted `detectBaseBranch` (different candidate list, only-origin ref scope, different fallback). Two base-detectors can return different bases for the same repo. Also, `src/git/index.js` kept a dead `rawRun` import + `void rawRun;` scaffolding deferred from Phase 1.

## What Changes

- Remove `pr.js` `detectBaseBranch`; route PR base resolution through git's canonical `detectDefaultBaseBranch` (imported from `./git`). Drop the now-redundant pr-module test (the detector is covered by `test/git-base-branch.test.js`).
- Remove the dead `rawRun` import and `void rawRun;` from `git/index.js` (and the stale JSDoc reference).

## Impact

- Surface: PR base detection (`gx pr`). Unifies on the more robust detector (also checks local heads). Common cases unchanged; edge-case differences (`develop` candidate, no-base fallback) converge to the canonical behavior.
- Risk: low. Zero new test failures vs base (33→33). Detector behavior is spec'd + tested in #618.
- Deferred (NOT in this PR): A3 sandbox-helper consolidation (3 of 8 helpers DRIFTED between `sandbox/index.js` and `cli/shared/sandbox.js` — needs drift reconciliation, not a partial dedup); A7 launch.js registry-shape (inferred/not-verified defensive code); B5 finish base-branch hoist (marginal perf, finish is not a hot loop).
