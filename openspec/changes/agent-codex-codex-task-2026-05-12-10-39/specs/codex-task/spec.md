## ADDED Requirements

### Requirement: PostToolUse edit tracker Python compatibility
The `PostToolUse` edit-tracker hook SHALL run successfully under the system `python3` used by Claude Code when that interpreter is Python 3.10 or newer.

#### Scenario: Claude edit tracker hook starts cleanly
- **WHEN** Claude Code invokes `.claude/hooks/post_edit_tracker.py` with a valid `PostToolUse` payload
- **THEN** the hook exits with status `0`
- **AND** no `ImportError` traceback is emitted for `datetime.UTC`.
