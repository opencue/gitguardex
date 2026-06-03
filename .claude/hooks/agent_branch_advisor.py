#!/usr/bin/env python3
"""SessionStart + UserPromptSubmit hook — proactively tell the agent it is on a
protected branch BEFORE it tries to edit or commit.

Every other gitguardex guard is reactive: skill_guard.py (PreToolUse) and the
pre-commit git hook only fire once the agent *attempts* a blocked action, so the
agent learns the rule by smacking into a wall, recovering, and smacking into the
next one. This advisor surfaces the branch state and the sanctioned
`gx branch start` command up front, so the agent's first move on a protected
branch is to open an isolated worktree instead of bouncing off the commit guard.

Behaviour:
  - Silent on agent/* (and other recognized agent) branches — the sanctioned
    state, zero noise.
  - Silent on non-agent, non-protected branches (e.g. feature/*) — Claude may
    edit there and the guards allow it.
  - On a protected branch (dev/main/master + any GUARDEX_PROTECTED_BRANCHES /
    multiagent.protectedBranches additions) it injects an advisory.
  - Fail-open: any error → no output, exit 0. Never blocks a session or a prompt.

Wired into BOTH events (see EXPECTED_HOOK_MATCHERS in src/cli/commands/claude.js):
  - SessionStart     announce once at the top of the session (incl. resume/clear)
  - UserPromptSubmit  re-check each turn; catches drift back onto a protected
                      branch mid-session (e.g. right after `gx branch finish`)

Output is the documented context-injecting shape for both events:
  {"hookSpecificOutput": {"hookEventName": <event>, "additionalContext": <text>}}
emitted on exit 0. NOTE: UserPromptSubmit treats exit 2 as "reject the prompt",
so this hook must always exit 0 — advise, never block.

The branch/protection predicates are imported from the sibling skill_guard.py so
the advisory's notion of "protected" / "agent branch" is byte-identical to what
the guards actually enforce. `gx claude install` copies both files together, so
they stay version-matched; the import is still wrapped to fail open if a target
repo somehow carries an older skill_guard.py without these helpers.
"""

import json
import os
import sys
from pathlib import Path

try:
    from skill_guard import (
        current_branch,
        find_repo_root,
        guardex_repo_is_enabled,
        is_agent_branch,
        resolve_protected_branches,
    )
except Exception:  # noqa: BLE001 - fail open if sibling hook is missing/older
    sys.exit(0)


SUPPORTED_EVENTS = ("SessionStart", "UserPromptSubmit")


def resolve_repo_root(cwd: str) -> Path:
    """Resolve the guarded repo from the session cwd (falls back to process cwd)."""
    if cwd:
        return find_repo_root(cwd)
    return find_repo_root(os.getcwd())


def advisory_text(branch: str) -> str:
    return (
        f"⚠ GUARDEX: this session is on protected branch '{branch}'. "
        "Agent edits and commits are BLOCKED here by gitguardex.\n"
        "Before editing any file in this repo, open an isolated agent worktree "
        "first (it carries any uncommitted changes with you):\n"
        '    gx branch start "<task>" "<agent-name>"\n'
        "Then `cd` into the printed worktree path and do all work from there. "
        "Finish completed work with:\n"
        "    gx branch finish --via-pr --wait-for-merge --cleanup\n"
        "(On an agent/* branch you will not see this notice.)"
    )


def main() -> None:
    try:
        raw = sys.stdin.read()
        input_data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, EOFError, ValueError):
        sys.exit(0)  # fail-open

    event = input_data.get("hook_event_name", "")
    cwd = input_data.get("cwd", "") or ""

    try:
        repo_root = resolve_repo_root(cwd)
        if not guardex_repo_is_enabled(repo_root):
            sys.exit(0)
        branch = current_branch(repo_root)
    except Exception:  # noqa: BLE001 - never let a git/env hiccup block the agent
        sys.exit(0)

    if not branch or is_agent_branch(branch):
        sys.exit(0)
    if branch not in resolve_protected_branches(repo_root):
        sys.exit(0)

    hook_event = event if event in SUPPORTED_EVENTS else "SessionStart"
    payload = {
        "hookSpecificOutput": {
            "hookEventName": hook_event,
            "additionalContext": advisory_text(branch),
        }
    }
    print(json.dumps(payload))
    sys.exit(0)


if __name__ == "__main__":
    main()
