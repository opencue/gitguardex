## ADDED Requirements

### Requirement: `gx` verifies the self-update actually advanced the on-disk package version

The `gx` self-updater SHALL confirm that the globally-installed `@imdeadpool/guardex/package.json` reports the advertised latest version after `npm i -g @imdeadpool/guardex@latest` returns success, and SHALL transparently retry with the pinned version when it does not. The CLI SHALL NOT announce "✅ Updated to latest published version" when the on-disk version is still below the advertised latest.

The installed version resolution is implemented via `npm root -g` + a `package.json` read; when that resolution fails (e.g. in test fixtures that do not stub `npm root -g`), verification is skipped and the pre-existing success path is preserved.

#### Scenario: `@latest` install is idempotent; pinned retry advances the version
- **GIVEN** the globally-installed `@imdeadpool/guardex/package.json` is at a version lower than `npm view @imdeadpool/guardex version` reports
- **AND** `npm i -g @imdeadpool/guardex@latest` returns status 0 but does NOT rewrite the on-disk `package.json` (npm cache / dedupe quirk)
- **WHEN** the user accepts the `gx` update prompt
- **THEN** `gx` reads the on-disk `package.json` via `npm root -g` + fs
- **AND** detects the on-disk version is still below the advertised latest
- **AND** runs `npm i -g @imdeadpool/guardex@<latest-version>` with the exact version pinned
- **AND** re-reads the on-disk `package.json` to confirm it now reports `<latest-version>`
- **AND** prints `✅ Updated to latest published version.`

#### Scenario: Pinned retry also fails — surface an actionable hint, do not claim success
- **GIVEN** the `@latest` install is idempotent AND the pinned retry `npm i -g @imdeadpool/guardex@<latest>` returns status 0 but still does not rewrite the on-disk version
- **WHEN** the user accepts the `gx` update prompt
- **THEN** `gx` prints a warning naming the still-stale on-disk version
- **AND** includes `npm root -g && npm cache verify` as the investigation next step
- **AND** does NOT print `✅ Updated to latest published version.`
- **AND** does NOT loop internally — one retry cycle per invocation.

#### Scenario: `npm root -g` is not resolvable (test environment / missing npm)
- **GIVEN** `npm root -g` returns non-zero or empty output, or the resolved `<root>/@imdeadpool/guardex/package.json` does not exist
- **WHEN** `gx` verifies the install
- **THEN** the verification is skipped and the pre-existing success path prints `✅ Updated to latest published version.` exactly as before
- **AND** no pinned retry is attempted.

#### Scenario: First `@latest` install actually advances the version (the happy path)
- **GIVEN** `npm i -g @imdeadpool/guardex@latest` correctly rewrites the on-disk `package.json` to the advertised latest version
- **WHEN** `gx` verifies the install
- **THEN** the on-disk version matches the advertised latest and the pinned retry is NOT invoked
- **AND** `gx` prints `✅ Updated to latest published version.`
