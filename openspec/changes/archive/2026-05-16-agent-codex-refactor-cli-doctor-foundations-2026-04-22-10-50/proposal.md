## Why

- `bin/multiagent-safety.js` carries the protected-main doctor sandbox flow as one long untyped routine.
- `runDoctorInSandbox()` mixes bootstrap, nested execution, auto-commit, finish, merge-back, lock sync, scaffold sync, output rendering, and auto-finish summary handling in a single code path.
- That shape makes regressions harder to catch and encourages more defensive `summary?.details?.[0]` style access instead of clear contracts.

## What Changes

- Add JSDoc typedef contracts for the doctor sandbox and auto-finish summary/result payloads that currently flow through loosely-shaped objects.
- Extract the protected-main doctor sandbox lifecycle into explicit internal phases/helpers so the code reads as a sequence of steps instead of one large mixed-responsibility block.
- Preserve the current CLI surface, output wording, and shell-helper behavior for this pass.
- Defer the broader command-parser replacement and shell-to-Node migration to follow-up changes once the typed/lifecycle foundation is in place.

## Impact

- Primary surface: `gx doctor` on protected branches, especially the auto-finish and merge-back path.
- Secondary surface: internal auto-finish summary classification used for compact/failure reporting.
- Risk is moderate because the flow is behaviorally sensitive, so the existing doctor regression tests remain the lock before and after refactoring.
