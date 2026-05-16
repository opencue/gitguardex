## ADDED Requirements

### Requirement: Hook scripts have a single canonical location
The repo SHALL store every Claude/Codex Python hook (`post_edit_tracker.py`,
`skill_activation.py`, `skill_guard.py`, `skill_tracker.py`) once under
`.claude/hooks/`. Every duplicate under `.codex/hooks/` SHALL be a relative
symlink pointing at the canonical file.

#### Scenario: Symlink parity
- **WHEN** the test suite resolves both `.codex/hooks/<name>` and
  `.claude/hooks/<name>` via `realpath`
- **THEN** the two paths resolve to the same file
- **AND** `.codex/hooks/<name>` reports as a symlink via `lstat`.

### Requirement: skill_guard supports configurable agent-branch prefixes
`skill_guard.py` SHALL treat any branch whose name starts with one of the
prefixes in `GUARDEX_AGENT_BRANCH_PREFIXES` (comma- or space-separated) as an
agent-managed branch, in addition to the always-recognized `agent/` prefix.
Tokens without a trailing `/` SHALL be normalized by appending `/` so the
match remains anchored to a path boundary.

#### Scenario: claude/* is accepted when env var is set
- **WHEN** `GUARDEX_AGENT_BRANCH_PREFIXES="claude/"` is exported
- **AND** the current branch is `claude/improve-codebase-VctLa`
- **THEN** the hook allows mutating shell commands as if the branch were
  `agent/<name>/<slug>`.

#### Scenario: Default behavior is unchanged
- **WHEN** `GUARDEX_AGENT_BRANCH_PREFIXES` is unset
- **AND** the current branch is `claude/improve-codebase-VctLa`
- **THEN** the hook blocks mutating shell commands exactly as before.

### Requirement: skill_guard allows read-only version probes
`skill_guard.py` SHALL allow `--version` / `-v` probes for common runtimes
(`node`, `npm`, `pnpm`, `yarn`, `python`, `python3`, `ruby`, `go`, `java`,
`cargo`, `rustc`, `deno`, `bun`) on protected and non-agent branches without
requiring the `ALLOW_BASH_ON_NON_AGENT_BRANCH=1` override.

#### Scenario: node --version is allowed on main
- **WHEN** the current branch is `main`
- **AND** the tool input is `{ command: "node --version" }`
- **THEN** the hook exits 0.

### Requirement: skill_guard blocks mutations on protected branches
`skill_guard.py` SHALL continue to block mutating commands — file removal,
mutating git commands such as `checkout`, `reset --hard`, `push origin main`,
and redirections that overwrite files — on protected and non-agent branches
unless `ALLOW_BASH_ON_NON_AGENT_BRANCH=1` is exported.

#### Scenario: rm is blocked on main
- **WHEN** the current branch is `main`
- **AND** the tool input is `{ command: "rm seed.txt" }`
- **THEN** the hook exits 2 with a `BLOCKED:` message.
