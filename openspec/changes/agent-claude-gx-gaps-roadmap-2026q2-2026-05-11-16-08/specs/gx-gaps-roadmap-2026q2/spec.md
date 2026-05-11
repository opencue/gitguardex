## ADDED Requirements

### Requirement: gx Q2 2026 gap roadmap deliverable
The system SHALL ship a documentation-only roadmap that converts the seven 2026-05-11 gx gap conversations into reviewable, independently-pickable proposal seeds for future changes.

The roadmap MUST contain:

- A `roadmap.md` index file inside the change folder that lists every gap with: gap number, title, tier (`T1`/`T2`/`T3`), effort estimate, dependencies on other gaps, and a one-line problem statement.
- A `gaps/NN-<slug>.md` file for each of the seven gaps using a consistent template (Problem, Evidence in current code, Proposed CLI surface, Tier, Effort, Dependencies, Open questions, Acceptance criteria).
- Exactly seven gap files, numbered `01` through `07`, covering: interactive recovery verb, structured observability surface, stranded-lane filter, conflict-resolution verb, cross-process lock enforcement, per-remote trust policy, and `src/cli/main.js` refactor.

The roadmap MUST NOT modify any file outside `openspec/changes/agent-claude-gx-gaps-roadmap-2026q2-2026-05-11-16-08/` (no `src/`, no `scripts/`, no `bin/`, no `package.json` bump, no `CHANGELOG.md`).

#### Scenario: Index lists all seven gaps
- **WHEN** a reader opens `roadmap.md`
- **THEN** they see a single table or ordered list with exactly seven rows
- **AND** each row links to its corresponding `gaps/NN-<slug>.md`
- **AND** each row shows tier, effort, and dependencies inline.

#### Scenario: Each gap doc is a future-proposal seed
- **WHEN** a reader opens any `gaps/NN-<slug>.md`
- **THEN** the file follows the consistent template
- **AND** the Problem section cites at least one piece of concrete evidence (file path, command output, attention-inbox state, or merged-PR reference)
- **AND** the Proposed CLI surface section names the exact subcommand or flag introduced
- **AND** the Acceptance criteria section is specific enough to be lifted into a future change's `tasks.md`.

#### Scenario: Roadmap is docs-only
- **WHEN** `git diff --name-only main...HEAD` is inspected after the change is committed
- **THEN** every changed path is rooted under `openspec/changes/agent-claude-gx-gaps-roadmap-2026q2-2026-05-11-16-08/`
- **AND** no files under `src/`, `scripts/`, `bin/`, `templates/`, `.claude/`, or `package.json` appear.
