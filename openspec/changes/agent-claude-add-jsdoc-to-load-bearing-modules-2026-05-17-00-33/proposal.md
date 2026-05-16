## Why

- `src/git/index.js` and `src/finish/index.js` are load-bearing helpers used by every `gx` lifecycle command (`branch start/finish`, `cleanup`, `merge`, `sync`). They had no JSDoc, no `@ts-check`, and no recorded throw contract — making it harder for agents to extend them safely.

## What Changes

- Add `// @ts-check` to both files and JSDoc (`@param`/`@returns`/throws + a one-line summary) for every exported function.
- Introduce module-scoped `@typedef`s for the recurring object shapes (`SpawnResult`, `RunOptions`, `SetupOperation`, `LockRegistryStatus`, `AheadBehindCounts`, `EnsureRepoBranchResult`, `AgentWorktreeEntry`, `FinishOptions`, `AutoCommitResult`).
- No behavior, control flow, or signatures change.

## Impact

- Documentation/type-check only. No runtime risk.
- Note: `src/locks/` does not exist in the tree, so the change is scoped to `src/git/` and `src/finish/` only.
- `npm test` baseline failures (23 environment-dependent tests) are unaffected; same set passes/fails before and after.
