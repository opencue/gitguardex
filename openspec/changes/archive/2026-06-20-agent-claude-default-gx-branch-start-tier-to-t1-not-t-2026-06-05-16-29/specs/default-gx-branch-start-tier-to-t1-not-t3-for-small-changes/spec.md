## ADDED Requirements

### Requirement: gx branch start defaults to tier T1
`gx branch start` SHALL scaffold at tier T1 (notes.md only) when `--tier` is omitted and `GUARDEX_OPENSPEC_TIER` is unset, instead of the former T3 default.

#### Scenario: Omitted tier yields T1
- **WHEN** `gx branch start "<task>" "<name>"` runs without `--tier`
- **THEN** the OpenSpec change scaffold contains `notes.md` and no `proposal.md`, and no plan workspace is created
- **AND** the output reports `OpenSpec tier: T1` with an escalation hint.

#### Scenario: Explicit tier still honored
- **WHEN** `--tier T2` or `--tier T3` (or `GUARDEX_OPENSPEC_TIER`) is given
- **THEN** the corresponding fuller scaffolding is created, unchanged from before.
