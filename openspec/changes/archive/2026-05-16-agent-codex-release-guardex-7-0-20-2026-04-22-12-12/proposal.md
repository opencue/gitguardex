## Why

- The npm registry already serves `@imdeadpool/guardex@7.0.19`, so the package metadata needs the next publishable patch version before another release can be cut.
- `main` now contains post-`7.0.19` operator-facing improvements that are not recorded in the README release history yet, so the release notes would drift again without a matching version bump.

## What Changes

- Bump the package release metadata from `7.0.19` to `7.0.20` in `package.json` and `package-lock.json`.
- Add a `README.md` release-notes entry for `v7.0.20` that captures the shipped Active Agents ownership visibility and merged-cleanup evidence fixes already merged on `main`.

## Impact

- Unblocks the next npm publish without changing runtime behavior beyond what is already merged on `main`.
- Keeps the packaged version, lockfile metadata, and README release history aligned so the release state stays trustworthy.
