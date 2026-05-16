## ADDED Requirements

### Requirement: `gx status` reflects the current companion npm toolchain

The `gx status` and `gx setup` npm-global companion-tool path SHALL track the current machine-detectable companion CLI set: `oh-my-codex`, `oh-my-claude-sisyphus`, `@fission-ai/openspec`, `cavemem`, and `@imdeadpool/codex-account-switcher`.

#### Scenario: `cavemem` is installed globally

- **GIVEN** `npm ls -g --json` includes `cavemem`
- **WHEN** the user runs `gx status` or `gx status --json`
- **THEN** the reported services include `cavemem`
- **AND** its state is `active`

#### Scenario: setup installs missing companion npm tools

- **GIVEN** `oh-my-codex` is already present globally
- **AND** one or more of `oh-my-claude-sisyphus`, `@fission-ai/openspec`, `cavemem`, or `@imdeadpool/codex-account-switcher` are missing
- **WHEN** the user runs `gx setup` and approves the optional global install prompt
- **THEN** Guardex installs only the missing companion npm tools

### Requirement: README companion docs use current official tool names

The README companion-tools section SHALL use the current official repo/install names for the Claude-side orchestration project and SHALL document the Caveman ecosystem add-ons (`caveman`, `cavemem`, `cavekit`) with their official companion-tool guidance.

#### Scenario: reader checks the companion tools section

- **GIVEN** a reader opens the README companion-tools section
- **WHEN** they inspect the Claude and Caveman ecosystem entries
- **THEN** they see `oh-my-claudecode` as the repo/project name
- **AND** they see `oh-my-claude-sisyphus` as the npm runtime package name
- **AND** they see companion entries for `caveman`, `cavemem`, and `cavekit`
