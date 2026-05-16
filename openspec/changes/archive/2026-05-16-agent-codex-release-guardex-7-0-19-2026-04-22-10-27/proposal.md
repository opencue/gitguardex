## Why

- The user asked for the next npm version in `gitguardex`, so the package metadata needs the next publishable patch release after `7.0.18`.
- The shipped behavior since `7.0.18` is not recorded in the README release history yet, so the package version and release notes would drift again without a matching docs update.

## What Changes

- Bump the package release metadata from `7.0.18` to `7.0.19` in `package.json` and `package-lock.json`.
- Add a `README.md` release-notes entry for `v7.0.19` that captures the shipped targeted `--force <managed-path>` recovery flow plus the post-`7.0.18` UX refinements already merged on `main`.

## Impact

- Unblocks the next npm publish without changing runtime behavior beyond what is already merged on `main`.
- Keeps the packaged version, lockfile metadata, and README release history aligned so the release state is easier to trust.
