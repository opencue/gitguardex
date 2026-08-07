## ADDED Requirements

### Requirement: A blocking finding SHALL NOT be cleared by its absence alone

Across auto-fix rounds the gate SHALL track every file that has carried a
blocking finding. A file SHALL be considered resolved only when a repair round
actually edited it, or the latest review still reports a finding in it.
Otherwise the gate SHALL block.

#### Scenario: A blocking finding vanishes after an unrelated fix

- **WHEN** a file carried a blocking finding, a repair round edited only other files, and the re-review no longer reports that file
- **THEN** the gate SHALL block
- **AND** the error SHALL name the file and state that absence is not a fix

#### Scenario: The repair round edited the file

- **WHEN** a repair round edited the file that carried the blocking finding and the re-review reports nothing blocking
- **THEN** the gate SHALL proceed

#### Scenario: The finding returns below the block threshold

- **WHEN** the latest review still reports a finding in that file at a non-blocking severity
- **THEN** the file SHALL count as reviewed and the gate SHALL proceed

#### Scenario: Auto-fix is not enabled

- **WHEN** `--gate-autofix` is absent
- **THEN** only one review round runs and the carry-forward check SHALL have no effect

#### Scenario: The latest review returns no usable findings list

- **WHEN** the findings list is absent or malformed
- **THEN** every carried file SHALL be treated as unexplained rather than resolved

### Requirement: The agent contract SHALL direct agents to the self-repairing gated ship

The marker-managed contract templates SHALL instruct agents to finish with
`--gate-review --gate-autofix` by default, SHALL describe what each gate flag
enforces, and SHALL state that posting a review is not merging.

#### Scenario: A repo receives the contract block

- **WHEN** the multiagent-safety block is installed into a repo
- **THEN** it SHALL name the gated finish command as the default completion path
- **AND** it SHALL state that `gx pr-review` posts findings and exits while only `gx branch finish` merges
