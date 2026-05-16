## Why

- The repo brand is already GitGuardex, but the published npm package still uses the older `@imdeadpool/guardex` scope.
- The README, install prompts, tutorial copy, and release notes still send users to the old package name.
- The mismatch makes install/update guidance look inconsistent and weakens the GitGuardex rename.

## What Changes

- Rename the published package metadata from `@imdeadpool/guardex` to `@imdeadpool/gitguardex`.
- Update CLI install/setup prompts and self-update expectations to use the renamed package.
- Refresh README, tutorial copy, Reddit kit, and README-linked SVG assets so npm instructions point at `gitguardex`.

## Compatibility

- Keep `gx` as the preferred short command.
- Keep `gitguardex` as the long-form command.
- Keep `guardex` as a legacy bin alias so existing shells do not break during the package-name transition.
