#!/usr/bin/env python3
"""PostToolUse hook — track Skill tool invocations in session state.

Matcher: Skill

Records skill usage in skills-used-{session_id}.json so that
skill_guard.py can check sessionSkillUsed and allow edits.
"""

import json
import sys
from contextlib import nullcontext
from pathlib import Path

# gx-hook-state-lock-v3: never write import caches outside the lock.
sys.dont_write_bytecode = True

try:
    from _session_presence import locked_hook_state
except ImportError:

    def locked_hook_state():
        # A standalone install may contain only this script. Managed lanes
        # still require the shared lock helper to coordinate with cleanup.
        hook = Path(__file__).resolve()
        return nullcontext(hook.is_file() and not any(
            parent.name == "agent-worktrees" and parent.parent.name in (".omx", ".omc")
            for parent in hook.parents[3:]
        ))

try:
    from _analytics import emit_event
except ImportError:

    def emit_event(*_a: object, **_k: object) -> None:
        pass


def record_skill_used(session_id: str, skill_name: str) -> None:
    """Record skill invocation in session state for skill_guard lookups."""
    with locked_hook_state() as writable:
        if not writable:
            return
        state_dir = Path(__file__).resolve().parent / "state"
        state_dir.mkdir(parents=True, exist_ok=True)
        state_path = state_dir / f"skills-used-{session_id}.json"

        state: dict[str, list[str]] = {"suggestedSkills": [], "usedSkills": []}
        if state_path.exists():
            try:
                with open(state_path) as f:
                    state = json.load(f)
            except (json.JSONDecodeError, PermissionError):
                pass

        used = state.get("usedSkills", [])
        if skill_name not in used:
            used.append(skill_name)
        state["usedSkills"] = used

        with open(state_path, "w") as f:
            json.dump(state, f, indent=2)


def main() -> None:
    try:
        input_data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)

    session_id = input_data.get("session_id", "unknown")
    tool_input = input_data.get("tool_input", {})
    skill_name = tool_input.get("name", "") or tool_input.get("skill", "")

    if not skill_name:
        sys.exit(0)

    record_skill_used(session_id, skill_name)

    emit_event(
        session_id,
        "hook.invoked",
        {
            "hook": "skill_tracker",
            "trigger": "PostToolUse",
            "outcome": "tracked",
            "skill": skill_name,
            "exit_code": 0,
        },
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
