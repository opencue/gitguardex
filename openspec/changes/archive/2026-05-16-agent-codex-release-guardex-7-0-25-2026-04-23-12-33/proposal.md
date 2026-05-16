## Why

- npm and GitHub Releases are both currently at `@imdeadpool/guardex@7.0.24`, so the next publishable patch version needs to advance before another release can be cut.
- `main` now includes more operator-facing Active Agents companion improvements than the current README release history records, so the release notes would drift again without a matching version bump.
- The shipped VS Code companion code changed after the last manifest bump, so the bundled extension version needs a fresh visible version for workspace auto-update and install verification.

## What Changes

- Bump the package release metadata from `7.0.24` to `7.0.25` in `package.json` and `package-lock.json`.
- Add a `README.md` release-notes entry for `v7.0.25` that calls out the shipped `GitGuardex Active Agents` VS Code companion improvements visible in Source Control.
- Bump `vscode/guardex-active-agents/package.json` and `templates/vscode/guardex-active-agents/package.json` from `0.0.8` to `0.0.9` so the bundled companion can surface the newer shipped build.

## Impact

- Unblocks the next npm package release and matching GitHub release without changing the Guardex CLI runtime beyond what is already merged on `main`.
- Keeps the package version, companion manifest version, and README release history aligned so release state stays trustworthy to operators using the VS Code surface.
