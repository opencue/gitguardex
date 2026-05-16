## Why

- The current `gx release` command still runs `npm publish` directly, so maintainers have to open GitHub Releases manually and hand-write the release body.
- The latest public release (`v7.0.15`) only shows the patch-bump note even though the shipped changes since `v7.0.12` also include nested protected-repo doctor fixes, protected-main sandbox setup, and the Claude companion naming cleanup.
- This repo already keeps the authoritative release history in `README.md`, so the GitHub release flow should reuse that text instead of drifting into manual summaries.

## What Changes

- Change `gx release` so it generates release notes from `README.md`, aggregating every README release section newer than the last published GitHub release and up to the current package version.
- Have `gx release` resolve the public GitHub repo from the package manifest, then create or update the GitHub release for the current version with the generated notes instead of running `npm publish` directly.
- Document the new release flow and use the generated text to rewrite the existing `v7.0.15` GitHub release body so it summarizes the changes since `v7.0.12`.

## Impact

- Affects the maintainer-only `gx release` path, CLI documentation, and release-related test coverage.
- Keeps npm publishing on the existing `release.yml` workflow, which still runs from `release.published` / manual dispatch.
- Main risk: GitHub release creation must target the public repo even when `origin` points at a mirror or worktree-management remote, so repo resolution must not rely on `origin` alone.
