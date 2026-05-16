## ADDED Requirements

### Requirement: AGENTS.md stays lean with subdoc links
The repo's `AGENTS.md` (which `CLAUDE.md` symlinks to) SHALL keep its editable, non-marker portion lean by linking to extracted subdocs under `.agent/` for verbose rules.

#### Scenario: Editable portion is bounded
- **WHEN** an agent reads `AGENTS.md`
- **THEN** the non-`multiagent-safety` editable portion contains only: intro, Objective, ExecPlans pointer, Quick rules, Workflow cheatsheet (with tier table), Environment, Code Conventions, Source of Truth (OpenSpec) pointer, Versioning Rule, and a table of links to `.agent/*.md` subdocs.
- **AND** the total file length stays under 600 lines (the marker-managed `multiagent-safety` block accounts for ~430 lines of that total and is unchanged).

#### Scenario: Subdocs exist for every linked entry
- **WHEN** `AGENTS.md` links to a `.agent/<NAME>.md` subdoc
- **THEN** the referenced file SHALL exist at that path with the original section's content preserved verbatim.

#### Scenario: Symlink preserved
- **WHEN** `readlink CLAUDE.md` is invoked
- **THEN** it SHALL print `AGENTS.md` (the symlink target is not replaced with a regular file).

#### Scenario: Marker section untouched
- **WHEN** the bytes between `<!-- multiagent-safety:START -->` and `<!-- multiagent-safety:END -->` are diffed against the same block on `main`
- **THEN** the diff SHALL be empty.

#### Scenario: SPECKIT section untouched
- **WHEN** the bytes between `<!-- SPECKIT START -->` and `<!-- SPECKIT END -->` are diffed against the same block on `main`
- **THEN** the diff SHALL be empty.
