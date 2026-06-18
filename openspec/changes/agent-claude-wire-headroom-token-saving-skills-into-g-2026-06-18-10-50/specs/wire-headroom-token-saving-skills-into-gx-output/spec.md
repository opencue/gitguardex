## ADDED Requirements

### Requirement: Headroom advisory prompt part
The AI setup prompt machinery SHALL expose a prompt-only `headroom` part that teaches
agents to compress large `gx` output, logs, and dumps through headroom when available,
and SHALL fall back gracefully (the part is advisory text; it imposes no dependency).

#### Scenario: Full prompt includes headroom guidance
- **WHEN** `gx prompt` is run with no part filter
- **THEN** the output includes a "Headroom context compression" section
- **AND** it names `headroom_compress`, `headroom_retrieve`, and `GUARDEX_COMPRESS_CMD`.

#### Scenario: Part is selectable and aliased
- **WHEN** `gx prompt --part headroom` (or the alias `--part compress`) is run
- **THEN** only the headroom slice is printed
- **AND** `gx prompt --list-parts` includes `headroom`.

#### Scenario: Prompt-only part is excluded from exec output
- **WHEN** `gx prompt --exec --part headroom` is run
- **THEN** the command exits non-zero with a "not available with --exec" error
- **AND** `gx prompt --exec` (no filter) omits the headroom part.

### Requirement: GUARDEX_COMPRESS_CMD runtime compression
gx SHALL route large narrative output through an external compressor when
`GUARDEX_COMPRESS_CMD` is set, and SHALL leave output unchanged otherwise.

#### Scenario: Compressor applied when configured
- **WHEN** `GUARDEX_COMPRESS_CMD` is set to a filter and a large narrative block is
  emitted to a non-TTY (terse) stream
- **THEN** the block is piped through the filter and the filter output is printed.

#### Scenario: Unchanged by default and fail-open
- **WHEN** `GUARDEX_COMPRESS_CMD` is unset, or the configured command fails, or the
  block is machine-readable (JSON) or below the size threshold
- **THEN** the original block is printed byte-for-byte
- **AND** regressions are covered by tests.
