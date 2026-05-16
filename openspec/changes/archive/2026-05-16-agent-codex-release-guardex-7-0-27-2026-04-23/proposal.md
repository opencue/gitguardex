## Why

- `@imdeadpool/guardex@7.0.26` is already published on npm, so the next publish attempt needs a fresh patch version.
- `main` now includes the shipped `agent-branch-start.sh` pipefail recovery fix and the PR-only `agent-branch-finish.sh` temp-integration cleanup fix, but the release history does not yet document those operator-facing changes.

## What Changes

- Bump the package release metadata from `7.0.26` to `7.0.27` in `package.json` and `package-lock.json`.
- Add a `README.md` release-notes entry for `v7.0.27` that documents the already-merged branch-start and branch-finish workflow fixes now included in the package payload.

## Impact

- Unblocks the next npm package publish and matching GitHub release without introducing new runtime behavior beyond what is already merged on `main`.
- Keeps the package version and README release history aligned so operators can see which shipped workflow fixes landed in the publishable package.
