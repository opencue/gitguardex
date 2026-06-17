## Why

Direct maintainer `npm publish` attempts fail when `package.json` still names a version that already exists on npm. The repository already has release-please and CI skip logic, but the local publish path still leaves the maintainer to remember a manual patch bump.

## What Changes

- Add a `prepublishOnly` lifecycle hook that checks whether the current package version already exists on npm.
- When the exact version is already published, bump `package.json`, `package-lock.json`, and README release notes to the next unpublished patch version before publish continues.
- Align the current release metadata to `7.1.1`, the next unpublished patch after the failed `7.1.0` publish.
- Leave normal release-please and GitHub Actions publish flows anchored to the committed package version unless explicitly overridden.
- Add regression tests for version selection, file updates, skip behavior, and manifest wiring.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `release-workflow`: direct maintainer `npm publish` gains an automatic already-published-version recovery path.

## Impact

- Affects `package.json`, `package-lock.json`, `.release-please-manifest.json`, README release notes, the local npm publish lifecycle, a new helper under `scripts/`, metadata tests, and release-workflow OpenSpec requirements.
