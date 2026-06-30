#!/usr/bin/env python3
"""PostToolUse hook — record this session's live editing presence.

Matcher: Edit|Write|MultiEdit

On every edit, upsert a per-session presence record
(.claude/hooks/state/session-<session_id>.json) capturing the file just
touched, the branch/worktree, and a fresh last_seen heartbeat. A sibling
session reads these back (via _session_presence.read_live_sessions, surfaced by
agent_branch_advisor.py) to see who else is editing the same tree right now.

Unlike the old tracker this is NOT restricted to Python backend files — any
edited path in the tree counts, since the whole point is to surface concurrent
edits to the SAME file (e.g. a .tsx storefront page) across sessions.

Fail-open: any error → exit 0, never blocks the edit.
"""

import json
import sys

try:
    from _session_presence import record_edit
except ImportError:  # presence module missing → nothing to record, fail open
    def record_edit(**_kwargs: object) -> None:
        return None

try:
    from _analytics import emit_event
except ImportError:

    def emit_event(*_a: object, **_k: object) -> None:
        pass


def main() -> None:
    try:
        input_data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)

    session_id = input_data.get("session_id", "unknown")
    tool_input = input_data.get("tool_input", {}) or {}
    file_path = tool_input.get("file_path", "")
    cwd = input_data.get("cwd", "") or ""
    tool = input_data.get("tool_name", "") or None

    if not file_path:
        sys.exit(0)

    record = record_edit(
        session_id=session_id,
        cwd=cwd,
        file_path=file_path,
        tool=tool,
    )

    emit_event(
        session_id,
        "hook.invoked",
        {
            "hook": "post_edit_tracker",
            "trigger": "PostToolUse",
            "outcome": "tracked" if record else "skipped",
            "matched_count": 1 if record else 0,
            "exit_code": 0,
        },
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
