## ADDED Requirements

### Requirement: Repo root SHALL NOT carry the `vscode-material-icon-theme` submodule

The system SHALL keep the repo root free of the `vscode-material-icon-theme` submodule and its `.gitmodules` registration.

#### Scenario: `.gitmodules` no longer registers `vscode-material-icon-theme`
- **WHEN** a contributor inspects `.gitmodules` at `HEAD`
- **THEN** no stanza named `[submodule "vscode-material-icon-theme"]` is present
- **AND** `git submodule status` does not list a `vscode-material-icon-theme` entry.

#### Scenario: `vscode-material-icon-theme` path is gone from the working tree
- **WHEN** a contributor runs `ls vscode-material-icon-theme` at the repo root
- **THEN** the path does not exist
- **AND** `git ls-tree HEAD vscode-material-icon-theme` returns no entry.

### Requirement: Repo root SHALL NOT carry the legacy `.agents` bridge symlink

The system SHALL remove the `.agents` symlink at the repo root and rely on the per-agent `.codex/` and `.claude/` surfaces directly.

#### Scenario: `.agents` is absent from `HEAD`
- **WHEN** a contributor runs `git ls-tree HEAD .agents`
- **THEN** the command returns no entry
- **AND** no `.agents` path exists in the working tree.

#### Scenario: Internal references migrate off `.agents`
- **WHEN** a contributor greps the repo (excluding `openspec/changes/archive/` and any historical `agent-codex-*` change folders) for `\.agents/`
- **THEN** the only match is the negative regex guard in `test/setup.test.js` that asserts settings commands MUST NOT reference `/.agents/hooks/`.

#### Scenario: Stale ignore patterns are dropped
- **WHEN** a contributor inspects `.gitignore`
- **THEN** none of `.agents/hooks/state/`, `.agents/.personality_migration`, `.agents/version.json`, `.agents/log/` appear.

### Requirement: Multi-agent state-file glob defaults SHALL reference the real per-agent paths

The system SHALL list the live `.codex/settings.local.json` and `.claude/settings.local.json` paths (not `.agents/settings.local.json`) in the auto-transfer, auto-resolve, and worktree-prune state-file glob defaults.

#### Scenario: Template script defaults expand cleanly
- **WHEN** a contributor inspects `AUTO_TRANSFER_EXCLUDE_DEFAULT` in `templates/scripts/agent-branch-start.sh`, `AUTO_RESOLVE_SAFE_GLOBS_DEFAULT` in `templates/scripts/agent-branch-finish.sh`, and `WORKTREE_STATE_EXCLUDE_GLOBS_DEFAULT` in `templates/scripts/agent-worktree-prune.sh`
- **THEN** each default contains `:.codex/settings.local.json:.claude/settings.local.json:`
- **AND** none of them contain `:.agents/settings.local.json:`.

#### Scenario: Agent contract Git Hygiene list matches
- **WHEN** a contributor reads the "Never stage or commit" list in `AGENTS.md` (and the `CLAUDE.md` symlink)
- **THEN** `.codex/settings.local.json` and `.claude/settings.local.json` are present
- **AND** `.agents/settings.local.json` is absent.
