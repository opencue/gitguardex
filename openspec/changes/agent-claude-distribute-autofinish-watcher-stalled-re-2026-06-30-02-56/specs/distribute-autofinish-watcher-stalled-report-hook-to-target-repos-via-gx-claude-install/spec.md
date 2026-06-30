## ADDED Requirements

### Requirement: Stalled-report hook and watcher reach target repos
`gx setup` SHALL deliver both `scripts/agent-stalled-report.sh` (the SessionStart hook shim) and `scripts/agent-autofinish-watch.sh` (the watcher it invokes) into a target repo's `scripts/` directory as regular executable files, so the SessionStart hook baked into the target's `settings.json` references a script that actually exists. Both scripts SHALL follow the PAIRED convention: the real file lives under `templates/scripts/` and `scripts/<file>` is a tracked symlink to it.

#### Scenario: setup delivers both scripts
- **WHEN** `gx setup` runs against a target repo
- **THEN** `scripts/agent-stalled-report.sh` and `scripts/agent-autofinish-watch.sh` exist in the target as executable regular files whose content matches `templates/scripts/`
- **AND** the delivered `agent-stalled-report.sh` runs and resolves the watcher next to it.

#### Scenario: pairing stays enforced
- **WHEN** `scripts/check-script-symlinks.sh` runs
- **THEN** both `scripts/agent-stalled-report.sh` and `scripts/agent-autofinish-watch.sh` are verified as symlinks into `templates/scripts/`
- **AND** replacing either symlink with a regular file fails the check.
