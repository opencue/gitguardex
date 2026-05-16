## ADDED Requirements

### Requirement: Colony replaces cavemem as the global coordination companion

Guardex SHALL detect and prompt for the Colony CLI package `@imdeadpool/colony-cli` as the global multi-agent coordination companion instead of `cavemem`.

#### Scenario: `gx status --json` reports the Colony companion

- **WHEN** the user runs `gx status --json`
- **THEN** the `services` array contains an entry named `colony`
- **AND** that entry exposes `packageName` as `@imdeadpool/colony-cli`
- **AND** the services array does not require a `cavemem` entry

#### Scenario: setup installs missing global companions

- **GIVEN** `@imdeadpool/colony-cli` is absent from detected global npm packages
- **WHEN** the user approves companion installation
- **THEN** Guardex includes `@imdeadpool/colony-cli` in the global npm install command
- **AND** Guardex does not install `cavemem` as part of the global companion set

### Requirement: README shows Colony runtime registration

Guardex documentation SHALL show users how to install Colony and register one or more agent runtimes.

#### Scenario: user reads companion tooling docs

- **WHEN** the README companion tools table is inspected
- **THEN** the Colony row includes `npm i -g @imdeadpool/colony-cli`
- **AND** it lists `colony install --ide codex`, `colony install --ide claude-code`, `colony install --ide cursor`, `colony install --ide gemini-cli`, and `colony install --ide opencode`
- **AND** it tells users to verify with `colony status`
