## ADDED Requirements

### Requirement: Routine work executes without OpenSpec artifacts
GitGuardex SHALL create a branch and isolated worktree for the default T1 tier
without creating an OpenSpec change or plan workspace.

#### Scenario: Default branch start
- **WHEN** `gx branch start` is run without `--tier`
- **THEN** it resolves to T1
- **AND** no `openspec/changes/` or `openspec/plan/` artifact is created.

#### Scenario: Explicit structured change
- **WHEN** `gx branch start --tier T2` is run
- **THEN** the OpenSpec change scaffold is still created.

### Requirement: Concise managed agent context is the default
GitGuardex SHALL install the minimal managed AGENTS block during normal setup,
including when the repository previously contained the full managed contract.

#### Scenario: Refresh an existing full contract
- **WHEN** `gx setup` is run without `--contract`
- **THEN** the managed block is replaced with the minimal contract
- **AND** repository-specific text outside the managed block is preserved.

#### Scenario: Explicit full contract
- **WHEN** `gx setup --contract` is run
- **THEN** the full managed contract is installed.

### Requirement: OpenSpec narration is opt-in
The full managed contract SHALL NOT require routine OpenSpec artifact updates.

#### Scenario: Agent performs routine implementation
- **WHEN** no user request or explicit T2/T3 workflow activates OpenSpec
- **THEN** the agent works directly in code and tests
- **AND** reports only concise verification and delivery evidence.
