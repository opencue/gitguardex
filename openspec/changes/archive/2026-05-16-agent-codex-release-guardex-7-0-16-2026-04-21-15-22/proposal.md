## Why

- `npm publish` rejected `@imdeadpool/guardex@7.0.15` because that version is already published, so the package needs the next publishable patch version before release can proceed.
- The shipped behavior since `7.0.15` is not captured in the README release notes yet, and `package-lock.json` is also still lagging behind the manifest version.

## What Changes

- Bump the package release metadata from `7.0.15` to `7.0.16` in `package.json` and `package-lock.json`.
- Add a `README.md` release-notes entry for `v7.0.16` that summarizes the post-`7.0.15` Guardex behavior now shipping in the package.
- Update the `gx release` integration expectation in `test/install.test.js` so the release workflow tracks the current package version.

## Impact

- Unblocks the next npm publish without changing runtime behavior beyond what is already merged on `main`.
- Keeps the packaged version, lockfile metadata, and documented release notes aligned so release state is easier to trust.
