#!/usr/bin/env python3
"""Shared live-session presence registry for gitguardex Claude hooks.

Multiple Claude Code sessions can run against the SAME worktree at once (two
chats editing the same files). gitguardex's file locks are branch-scoped and
only fire at commit time, so two sessions in one tree get no edit-time signal
that the other is touching the same path — the exact collision behind
"account.tsx is being live-edited by your other session".

This module turns the per-session PostToolUse edit record (already written by
post_edit_tracker.py) into a real *presence* registry and reads it back:

  - record_edit()        upsert THIS session's record on every Edit/Write
  - read_live_sessions() the OTHER sessions editing this tree right now
  - format_block()       a compact human banner line for the advisor hook
  - presence_fingerprint() change-detection so the banner doesn't spam

State lives next to the other hook state, one file per session:
    .claude/hooks/state/session-<session_id>.json

"Live" = last edit within a sliding window (default 900s, override with
GUARDEX_PRESENCE_WINDOW_SEC). last_seen IS the heartbeat — it is refreshed on
every edit, so an idle session naturally drops off the "editing now" view.

Everything here is best-effort and fail-open: any error returns an empty/default
result rather than raising, so a hook importing this never blocks a session.
"""

import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_WINDOW_SEC = 900
# Runtime / bookkeeping churn that is not the agent's actual work.
EXCLUDE_PREFIXES = (".claude/", ".omx/", ".omc/", ".git/", ".codex/")
EXCLUDE_SUBSTRINGS = ("__pycache__/",)
MAX_FILES = 25


def state_dir() -> Path:
    """Directory holding per-session state, shared with the other hooks."""
    return Path(__file__).resolve().parent / "state"


def window_sec() -> int:
    raw = os.environ.get("GUARDEX_PRESENCE_WINDOW_SEC", "")
    try:
        value = int(raw)
        return value if value > 0 else DEFAULT_WINDOW_SEC
    except (TypeError, ValueError):
        return DEFAULT_WINDOW_SEC


def _git(cwd: str, args: list[str]) -> "str | None":
    if not cwd:
        return None
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def worktree_top(cwd: str) -> "str | None":
    return _git(cwd, ["rev-parse", "--show-toplevel"])


def current_branch(cwd: str) -> "str | None":
    branch = _git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])
    return None if not branch or branch == "HEAD" else branch


def _record_path(session_id: str) -> Path:
    return state_dir() / f"session-{session_id}.json"


def _relpath(file_path: str, base: str) -> "str | None":
    """Repo-relative path under `base`, or None if outside the tree / invalid."""
    if not file_path:
        return None
    if not base:
        return os.path.basename(file_path)
    try:
        rel = os.path.relpath(file_path, base)
    except (ValueError, TypeError):
        return os.path.basename(file_path)
    # A path outside the worktree (../) is not part of this tree's work.
    if rel.startswith(".."):
        return None
    return rel


def is_trackable(rel: str) -> bool:
    if not rel:
        return False
    if any(rel.startswith(prefix) for prefix in EXCLUDE_PREFIXES):
        return False
    if any(sub in rel for sub in EXCLUDE_SUBSTRINGS):
        return False
    return True


def _read_record(session_id: str) -> dict:
    try:
        return json.loads(_record_path(session_id).read_text())
    except (OSError, ValueError):
        return {}


def _iso(now: "float | None") -> str:
    ts = time.time() if now is None else now
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _parse_iso(value: "str | None") -> "float | None":
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).timestamp()
    except (TypeError, ValueError):
        return None


def record_edit(
    *,
    session_id: str,
    cwd: str,
    file_path: str,
    tool: "str | None" = None,
    now: "float | None" = None,
) -> "dict | None":
    """Upsert this session's presence record for a single edited file.

    Returns the written record, or None when there is nothing to record
    (no session id, or an excluded / out-of-tree path). Never raises.
    """
    if not session_id:
        return None
    try:
        top = worktree_top(cwd) or cwd or ""
        rel = _relpath(file_path, top)
        if not rel or not is_trackable(rel):
            return None

        record = _read_record(session_id)
        files = record.get("files")
        if not isinstance(files, list):
            files = []
        if rel in files:
            files.remove(rel)  # move-to-most-recent
        files.append(rel)
        if len(files) > MAX_FILES:
            files = files[-MAX_FILES:]

        record.update(
            {
                "session_id": session_id,
                "repo_root": top,
                "worktree": top,
                "branch": current_branch(cwd),
                "current_file": rel,
                "files": files,
                "last_seen": _iso(now),
                "tool": tool,
                # Legacy fields kept so anything reading the old dirty record
                # shape still works.
                "modified": True,
                "last_modified": _iso(now),
            }
        )

        sdir = state_dir()
        sdir.mkdir(parents=True, exist_ok=True)
        path = _record_path(session_id)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(record, indent=2))
        os.replace(tmp, path)  # atomic
        return record
    except OSError:
        return None


def read_live_sessions(
    *,
    exclude_session: "str | None" = None,
    repo_root: "str | None" = None,
    now: "float | None" = None,
    window: "int | None" = None,
) -> list:
    """Other sessions that edited a file in this tree within the live window.

    Sorted most-recently-active first. Filters out the calling session and,
    when `repo_root` is given, any record from a different repo root.
    """
    now_ts = time.time() if now is None else now
    win = window if window is not None else window_sec()
    root_real = os.path.realpath(repo_root) if repo_root else None
    out = []
    try:
        candidates = sorted(state_dir().glob("session-*.json"))
    except OSError:
        return out
    for path in candidates:
        try:
            record = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        sid = record.get("session_id")
        if not sid or sid == exclude_session:
            continue
        if root_real and record.get("repo_root"):
            if os.path.realpath(record["repo_root"]) != root_real:
                continue
        age = None
        seen = _parse_iso(record.get("last_seen"))
        if seen is not None:
            age = now_ts - seen
        if age is None or age < 0 or age > win:
            continue
        record["_age_sec"] = int(age)
        out.append(record)
    out.sort(key=lambda r: r.get("_age_sec", 1 << 30))
    return out


def _human_age(age_sec: int) -> str:
    if age_sec < 60:
        return f"{age_sec}s"
    if age_sec < 3600:
        return f"{age_sec // 60}m"
    return f"{age_sec // 3600}h"


def presence_fingerprint(sessions: list) -> str:
    """Stable signature of who-is-editing-what; changes when the set changes,
    NOT when timestamps tick — so a per-turn banner only re-fires on real drift."""
    parts = sorted(
        f"{(s.get('session_id') or '')[:8]}:{s.get('current_file') or ''}"
        for s in sessions
    )
    return ";".join(parts)


def format_block(sessions: list, *, limit: int = 3) -> "str | None":
    """Compact banner block for the advisor hook, or None when no live peers."""
    if not sessions:
        return None
    count = len(sessions)
    plural = "s" if count > 1 else ""
    head = (
        f"↹ GUARDEX live sessions: {count} other session{plural} "
        "editing in this worktree right now:"
    )
    lines = [head]
    for record in sessions[:limit]:
        sid = (record.get("session_id") or "????????")[:8]
        current = record.get("current_file") or "(unknown file)"
        files = record.get("files") or []
        extra = max(0, len(files) - 1)
        more = f" (+{extra} more)" if extra else ""
        age = _human_age(int(record.get("_age_sec", 0)))
        lines.append(f"  • sess {sid} — {current}{more} · {age} ago")
    if count > limit:
        lines.append(f"  • …and {count - limit} more")
    lines.append(
        "Claim files (gx locks claim) or coordinate before editing the same paths."
    )
    return "\n".join(lines)
