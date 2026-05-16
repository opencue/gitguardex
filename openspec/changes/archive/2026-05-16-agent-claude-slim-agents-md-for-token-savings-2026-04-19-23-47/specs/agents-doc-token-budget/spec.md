## ADDED Requirements

### Requirement: Agent contract token budget
`AGENTS.md` SHALL stay under 18,000 bytes in the guardex repo so that the
per-turn contract load in Claude Code / Codex sessions stays under
~4,500 tokens.

#### Scenario: AGENTS.md below budget after slim
- **WHEN** `wc -c AGENTS.md` is run at the repo root
- **THEN** the reported byte count is less than 18,000.

### Requirement: multiagent-safety marker block matches canonical template
The installed multiagent-safety block in the repo-root `AGENTS.md` SHALL equal the content of `templates/AGENTS.multiagent-safety.md` byte-for-byte. The block is delimited by the marker comments `<!-- multiagent-safety:START -->` and `<!-- multiagent-safety:END -->`.

#### Scenario: Installed block matches the template
- **WHEN** the installed marker block is diffed against
  `templates/AGENTS.multiagent-safety.md`
- **THEN** the diff is empty.

### Requirement: No recodee-specific sections in guardex AGENTS.md
Guardex's `AGENTS.md` SHALL NOT include sections that reference files which
do not exist in this repo. Specifically, `## CLI Session Detection Lock` and
`## Rust Runtime Proxy Lock` SHALL NOT appear, and no bullet SHALL reference
`rust/codex-lb-runtime/src/main.rs` or `frontend/src/utils/account-working.ts`.

#### Scenario: Recodee-specific headings absent
- **WHEN** `grep -cE "^## (CLI Session Detection Lock|Rust Runtime Proxy Lock)" AGENTS.md`
  is run
- **THEN** the count is 0.
- **AND** `grep -c "rust/codex-lb-runtime/src/main.rs\|frontend/src/utils/account-working.ts" AGENTS.md`
  is 0.

### Requirement: No OpenSpec tasks.md scaffold in AGENTS.md
`AGENTS.md` SHALL NOT contain an OpenSpec `tasks.md` checklist scaffold
(sections `## 1. Specification` ... `## 5. Cleanup`) or the
`## ADDED Requirements` baseline-requirement pattern. That scaffolding lives
in `scripts/openspec/init-change-workspace.sh` output, not the contract.

#### Scenario: Scaffold headings absent
- **WHEN** `grep -cE "^## [0-9]\.|^## ADDED Requirements$" AGENTS.md` is run
- **THEN** the count is 0.
