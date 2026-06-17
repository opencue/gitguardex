## Context

`release-please` owns committed release bumps for the GitHub Actions path, and `.github/workflows/release.yml` already skips `npm publish` when the committed version exists on npm. The missing path is a maintainer running `npm publish` directly from a checkout after the current version has already been published.

## Decisions

- Use `prepublishOnly` so direct `npm publish` runs the check before npm creates and uploads the package.
- Query npm for the exact current package version and only mutate files when that version is already published.
- Search patch versions until the first unpublished version so repeated failed manual publishes can recover without guessing the next patch.
- Update `package.json`, root lockfile package metadata, and README release notes to keep release metadata aligned.
- Bump the committed metadata from `7.1.0` to `7.1.1` because the npm registry already contains `7.1.0` and `7.1.1` is currently unpublished.
- Skip by default during GitHub Actions and dry runs. CI release artifacts are generated from the committed package version, so CI should not rewrite the version between packing/signing and publishing.

## Risks

- The hook depends on npm registry reachability. It fails closed if the registry lookup cannot distinguish published from unpublished.
- The automatic bump is patch-only and requires the package version to be plain `x.y.z`; non-plain prerelease versions still need an intentional manual release flow.
- The generated README release note is intentionally minimal; maintainers can expand it before committing if a manual publish carries larger release narrative.
