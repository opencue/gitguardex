## ADDED Requirements

### Requirement: Welcome screen renders the gitguardex brand and strapline
The cockpit welcome screen SHALL render a multi-line ASCII gitguardex
brand block followed by a single-line `guarded multi-agent cockpit`
strapline, in place of the previous `gx` ASCII robot motif.

#### Scenario: Brand and strapline appear on the empty welcome
- **WHEN** `renderWelcomePage` is invoked with no active sessions
- **THEN** the rendered output contains the `\____|` marker from the
  bottom of the ASCII brand
- **AND** the output contains the substring `guarded multi-agent cockpit`.

### Requirement: Welcome screen advertises all four primary shortcuts
The cockpit welcome screen's `Next actions` block SHALL list `n`, `t`,
`l`, `p`, and `s` so users see all four primary dmux-style shortcuts on
first launch alongside the existing settings hint.

#### Scenario: Next actions list includes l and p
- **WHEN** `renderWelcomePage` is invoked with any state
- **THEN** the rendered output contains the substrings `l logs` and
  `p projects` in addition to the existing `n new agent`, `t terminal`,
  and `s settings` lines.

### Requirement: Welcome screen stays ASCII-only
The cockpit welcome screen SHALL remain plain-terminal safe: every
character in the rendered output (including the new brand block) MUST
fall within the printable ASCII range so terminals without unicode box
or block glyphs render correctly.

#### Scenario: No characters above U+007F appear in the output
- **WHEN** `renderWelcomePage` is invoked with any state
- **THEN** the rendered output contains no character in the range
  `[-￿]`.
