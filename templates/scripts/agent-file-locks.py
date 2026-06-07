#!/usr/bin/env python3
"""Per-file lock registry for concurrent agent branches.

Locks are scoped by *owner identity* = (branch, agent). The agent dimension is
optional: pass `--agent <id>` or set GUARDEX_AGENT_ID. It exists so that two
agents sharing ONE worktree (and therefore one branch) can still hold distinct
claims against each other — without it the owner is the branch alone, so
same-branch agents never conflict and silently overwrite each other. When no
agent identity is supplied anywhere, behavior is byte-identical to branch-only
locking (every identity collapses to (branch, "")).

Usage examples:
  gx locks claim --branch agent/a path/to/file1 path/to/file2
  gx locks claim --branch agent/a --agent alice path/to/file1
  gx locks claim --branch agent/a --allow-delete path/to/obsolete-file
  gx locks allow-delete --branch agent/a path/to/obsolete-file
  gx locks validate --branch agent/a --agent alice --staged
  gx locks release --branch agent/a
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import fcntl
except ImportError:  # non-POSIX (e.g. Windows): cross-worktree locking degrades to best-effort
    fcntl = None


LOCK_FILE_RELATIVE = Path('.omx/state/agent-file-locks.json')
AGENT_ID_ENV = 'GUARDEX_AGENT_ID'
CRITICAL_GUARDRAIL_PATHS = {
    'AGENTS.md',
    '.githooks/pre-commit',
    '.githooks/pre-push',
    '.githooks/post-merge',
    '.githooks/post-checkout',
    'scripts/guardex-env.sh',
}
ALLOW_GUARDRAIL_DELETE_ENV = 'AGENT_ALLOW_GUARDRAIL_DELETE'


@dataclass
class LockEntry:
    branch: str
    claimed_at: str
    allow_delete: bool = False
    agent: str = ''


class LockError(Exception):
    pass


def run_git(args: list[str], cwd: Path) -> str:
    result = subprocess.run(
        ['git', *args],
        cwd=str(cwd),
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        raise LockError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout.strip()


def resolve_repo_root() -> Path:
    output = run_git(['rev-parse', '--show-toplevel'], cwd=Path.cwd())
    return Path(output).resolve()


def normalize_repo_path(repo_root: Path, raw_path: str) -> str:
    joined = Path(raw_path)
    abs_path = joined if joined.is_absolute() else (repo_root / joined)
    normalized_abs = Path(os.path.normpath(str(abs_path)))
    try:
        relative = normalized_abs.relative_to(repo_root)
    except ValueError as exc:
        raise LockError(f"Path is outside repository: {raw_path}") from exc
    return relative.as_posix()


def lock_file_path(repo_root: Path) -> Path:
    return repo_root / LOCK_FILE_RELATIVE


def resolve_agent(args: argparse.Namespace) -> str:
    """Owner agent id: explicit --agent wins, else GUARDEX_AGENT_ID, else ''.

    Empty string means "no agent identity" — the legacy branch-only owner.
    """
    value = getattr(args, 'agent', None)
    if not value:
        value = os.environ.get(AGENT_ID_ENV, '')
    return (value or '').strip()


def owner_label(entry: dict[str, Any]) -> str:
    branch = str(entry.get('branch', ''))
    agent = str(entry.get('agent', ''))
    return f'{branch} as {agent}' if agent else branch


def owner_matches(entry: dict[str, Any], branch: str, agent: str) -> bool:
    """Does this branch+agent own the entry?

    Branch must always match. The agent dimension is a *refinement*: when either
    side is unscoped (agent == '' — the legacy branch-only owner) ownership falls
    back to branch level, so anonymous callers and branch-wide operations keep
    working and a named agent can adopt a pre-existing anonymous lock on its own
    branch. Two DIFFERENT named agents on the same branch do not match — that is
    the mutual exclusion this feature adds.
    """
    if str(entry.get('branch', '')) != branch:
        return False
    entry_agent = str(entry.get('agent', ''))
    if not agent or not entry_agent:
        return True
    return entry_agent == agent


def load_state(repo_root: Path) -> dict[str, Any]:
    path = lock_file_path(repo_root)
    if not path.exists():
        return {'locks': {}}
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise LockError(f'Lock file is invalid JSON: {path}') from exc

    if not isinstance(data, dict):
        return {'locks': {}}
    locks = data.get('locks', {})
    if not isinstance(locks, dict):
        return {'locks': {}}

    # Backward-compat normalization for older lock schema (no `agent` field).
    normalized_locks: dict[str, dict[str, Any]] = {}
    for file_path, entry in locks.items():
        if not isinstance(entry, dict):
            continue
        branch = str(entry.get('branch', ''))
        claimed_at = str(entry.get('claimed_at', ''))
        allow_delete = bool(entry.get('allow_delete', False))
        agent = str(entry.get('agent', ''))
        normalized_locks[str(file_path)] = {
            'branch': branch,
            'claimed_at': claimed_at,
            'allow_delete': allow_delete,
            'agent': agent,
        }

    return {'locks': normalized_locks}


def write_state(repo_root: Path, state: dict[str, Any]) -> None:
    path = lock_file_path(repo_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True) + '\n')
    tmp.replace(path)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def env_truthy(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


def staged_changes(repo_root: Path) -> list[tuple[str, str]]:
    out = run_git(['diff', '--cached', '--name-status', '--diff-filter=ACMRDTUXB'], cwd=repo_root)
    if not out:
        return []

    results: list[tuple[str, str]] = []
    for raw_line in out.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split('\t')
        status_token = parts[0]
        status = status_token[0]
        if status in {'R', 'C'}:
            if len(parts) < 3:
                continue
            path = parts[-1]
        else:
            if len(parts) < 2:
                continue
            path = parts[1]
        normalized = normalize_repo_path(repo_root, path)
        results.append((status, normalized))
    return results


def list_worktree_roots(repo_root: Path) -> list[Path]:
    """Every worktree path for this repo (porcelain). Falls back to [repo_root]
    when git cannot enumerate, so single-checkout behavior is unchanged."""
    try:
        out = run_git(['worktree', 'list', '--porcelain'], cwd=repo_root)
    except LockError:
        return [repo_root]
    roots: list[Path] = []
    for line in out.splitlines():
        if line.startswith('worktree '):
            roots.append(Path(line[len('worktree '):].strip()).resolve())
    return roots or [repo_root]


def load_all_locks(repo_root: Path) -> dict[str, list[dict[str, Any]]]:
    """Union of EVERY worktree's lock map: file path -> list of owner entries
    (one per worktree that claims it). Each worktree owns a separate lock file on
    disk, so a file's full ownership is only visible by reading them all. With a
    single worktree this is exactly that worktree's own locks (unchanged)."""
    merged: dict[str, list[dict[str, Any]]] = {}
    for root in list_worktree_roots(repo_root):
        try:
            state = load_state(root)
        except LockError:
            continue
        for file_path, entry in state['locks'].items():
            merged.setdefault(file_path, []).append(entry)
    return merged


def common_git_dir(repo_root: Path) -> Path:
    """Absolute git common dir — shared by every worktree of the repo."""
    common = run_git(['rev-parse', '--git-common-dir'], cwd=repo_root)
    path = Path(common)
    if not path.is_absolute():
        path = repo_root / path
    return path.resolve()


@contextmanager
def cross_worktree_lock(repo_root: Path):
    """Exclusive OS lock shared by ALL worktrees of the repo (it lives in the
    common git dir), so concurrent claim/release/validate runs — in the same or
    different worktrees — are serialized. Without it, two claims race on the
    read-modify-write of separate lock files and can both win the same path or
    drop each other's writes. Best-effort: a no-op where fcntl is unavailable or
    the lock file can't be created, so locking never hard-fails a command."""
    if fcntl is None:
        yield
        return
    try:
        lock_path = common_git_dir(repo_root) / 'agent-file-locks.lock'
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(lock_path, 'w')
    except (OSError, LockError):
        yield
        return
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()


def cmd_claim(args: argparse.Namespace, repo_root: Path) -> int:
    state = load_state(repo_root)
    locks: dict[str, dict[str, Any]] = state['locks']

    claim_agent = resolve_agent(args)
    files = [normalize_repo_path(repo_root, p) for p in args.files]
    conflicts: list[tuple[str, str]] = []

    # Conflict detection spans EVERY worktree of the repo, not just this one: a
    # file claimed by another owner in a sibling worktree must still block this
    # claim (each worktree keeps a separate lock file). The write below still
    # records the claim in THIS worktree's lock file.
    all_locks = load_all_locks(repo_root)
    for file_path in files:
        foreign = [e for e in all_locks.get(file_path, []) if not owner_matches(e, args.branch, claim_agent)]
        if foreign:
            conflicts.append((file_path, owner_label(foreign[0])))

    if conflicts:
        print('[agent-file-locks] Cannot claim files already locked by another owner:', file=sys.stderr)
        for file_path, owner in conflicts:
            print(f'  - {file_path} (locked by {owner})', file=sys.stderr)
        return 1

    for file_path in files:
        existing = locks.get(file_path, {})
        existing_allow_delete = bool(existing.get('allow_delete', False))
        # A named claim adopts/upgrades the entry's agent; an anonymous claim
        # keeps any existing agent rather than silently downgrading it.
        resolved_owner_agent = claim_agent or str(existing.get('agent', ''))
        locks[file_path] = LockEntry(
            branch=args.branch,
            claimed_at=now_iso(),
            allow_delete=args.allow_delete or existing_allow_delete,
            agent=resolved_owner_agent,
        ).__dict__

    write_state(repo_root, state)
    delete_note = ' (delete-approved)' if args.allow_delete else ''
    agent_note = f' as {claim_agent}' if claim_agent else ''
    print(f"[agent-file-locks] Claimed {len(files)} file(s) for {args.branch}{agent_note}{delete_note}.")
    return 0


def cmd_allow_delete(args: argparse.Namespace, repo_root: Path) -> int:
    state = load_state(repo_root)
    locks: dict[str, dict[str, Any]] = state['locks']
    files = [normalize_repo_path(repo_root, p) for p in args.files]
    agent = resolve_agent(args)

    missing: list[str] = []
    foreign: list[tuple[str, str]] = []
    for file_path in files:
        entry = locks.get(file_path)
        if not entry:
            missing.append(file_path)
            continue
        if not owner_matches(entry, args.branch, agent):
            foreign.append((file_path, owner_label(entry)))
            continue
        entry['allow_delete'] = True

    if missing or foreign:
        if missing:
            print('[agent-file-locks] Cannot enable delete: files are not claimed yet:', file=sys.stderr)
            for file_path in missing:
                print(f'  - {file_path}', file=sys.stderr)
        if foreign:
            print('[agent-file-locks] Cannot enable delete: files are owned by another owner:', file=sys.stderr)
            for file_path, owner in foreign:
                print(f'  - {file_path} (owner: {owner})', file=sys.stderr)
        return 1

    write_state(repo_root, state)
    print(f"[agent-file-locks] Enabled delete approval for {len(files)} file(s) on {args.branch}.")
    return 0


def cmd_release(args: argparse.Namespace, repo_root: Path) -> int:
    state = load_state(repo_root)
    locks: dict[str, dict[str, Any]] = state['locks']
    agent = resolve_agent(args)

    to_release: set[str]
    if args.files:
        requested = {normalize_repo_path(repo_root, p) for p in args.files}
        to_release = {p for p in requested if owner_matches(locks.get(p, {}), args.branch, agent)}
    else:
        to_release = {p for p, entry in locks.items() if owner_matches(entry, args.branch, agent)}

    for file_path in to_release:
        locks.pop(file_path, None)

    write_state(repo_root, state)
    print(f"[agent-file-locks] Released {len(to_release)} file(s) for {args.branch}.")
    return 0


def cmd_status(args: argparse.Namespace, repo_root: Path) -> int:
    state = load_state(repo_root)
    locks: dict[str, dict[str, Any]] = state['locks']
    agent_filter = resolve_agent(args)

    rows: list[tuple[str, str, str, str, bool]] = []
    for file_path, entry in sorted(locks.items()):
        branch = str(entry.get('branch', ''))
        if args.branch and branch != args.branch:
            continue
        agent = str(entry.get('agent', ''))
        if agent_filter and agent != agent_filter:
            continue
        claimed_at = str(entry.get('claimed_at', ''))
        allow_delete = bool(entry.get('allow_delete', False))
        rows.append((file_path, branch, agent, claimed_at, allow_delete))

    if not rows:
        print('[agent-file-locks] No active locks.')
        return 0

    print('[agent-file-locks] Active locks:')
    for file_path, branch, agent, claimed_at, allow_delete in rows:
        delete_flag = ' delete-ok' if allow_delete else ''
        agent_flag = f' [{agent}]' if agent else ''
        print(f'  - {file_path} | {branch}{agent_flag} | {claimed_at}{delete_flag}')
    return 0


def cmd_validate(args: argparse.Namespace, repo_root: Path) -> int:
    agent = resolve_agent(args)

    if args.staged:
        file_changes = staged_changes(repo_root)
    else:
        file_changes = [('M', normalize_repo_path(repo_root, p)) for p in args.files]

    file_changes = [
        (status, file_path)
        for status, file_path in file_changes
        if file_path and file_path != LOCK_FILE_RELATIVE.as_posix()
    ]
    if not file_changes:
        return 0

    missing: list[str] = []
    foreign: list[tuple[str, str]] = []
    delete_not_allowed: list[str] = []
    guardrail_delete_blocked: list[str] = []

    allow_guardrail_delete = env_truthy(os.environ.get(ALLOW_GUARDRAIL_DELETE_ENV))

    # Enforce claims across ALL worktrees: a file owned by another agent in a
    # sibling worktree blocks this commit, not just one claimed in this worktree.
    all_locks = load_all_locks(repo_root)
    for status, file_path in file_changes:
        owners = all_locks.get(file_path, [])
        if not owners:
            missing.append(file_path)
            continue

        foreign_owners = [e for e in owners if not owner_matches(e, args.branch, agent)]
        if foreign_owners:
            foreign.append((file_path, owner_label(foreign_owners[0])))
            continue

        if status == 'D':
            if file_path in CRITICAL_GUARDRAIL_PATHS and not allow_guardrail_delete:
                guardrail_delete_blocked.append(file_path)

            mine = next((e for e in owners if owner_matches(e, args.branch, agent)), None)
            allow_delete = bool(mine.get('allow_delete', False)) if mine else False
            if not allow_delete:
                delete_not_allowed.append(file_path)

    if not missing and not foreign and not delete_not_allowed and not guardrail_delete_blocked:
        return 0

    print('[agent-file-locks] Commit blocked: staged files must be safely claimed by this owner first.', file=sys.stderr)
    if missing:
        print('  Unclaimed files:', file=sys.stderr)
        for file_path in missing:
            print(f'    - {file_path}', file=sys.stderr)
    if foreign:
        print('  Files claimed by another owner:', file=sys.stderr)
        for file_path, owner in foreign:
            print(f'    - {file_path} (owner: {owner})', file=sys.stderr)
    if delete_not_allowed:
        print('  Delete not approved for claimed files:', file=sys.stderr)
        for file_path in delete_not_allowed:
            print(f'    - {file_path}', file=sys.stderr)
        print('    Approve explicit deletions with one of:', file=sys.stderr)
        print(
            f'      gx locks claim --branch "{args.branch}" --allow-delete <file...>',
            file=sys.stderr,
        )
        print(
            f'      gx locks allow-delete --branch "{args.branch}" <file...>',
            file=sys.stderr,
        )
    if guardrail_delete_blocked:
        print('  Critical guardrail file deletion blocked:', file=sys.stderr)
        for file_path in guardrail_delete_blocked:
            print(f'    - {file_path}', file=sys.stderr)
        print(
            f'    To intentionally allow this rare operation, set {ALLOW_GUARDRAIL_DELETE_ENV}=1 for the commit command.',
            file=sys.stderr,
        )

    print('\nClaim files with:', file=sys.stderr)
    print(f'  gx locks claim --branch "{args.branch}" <file...>', file=sys.stderr)
    return 1


def add_agent_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        '--agent',
        default=None,
        help=f'Owner agent id (defaults to ${AGENT_ID_ENV}); scopes ownership within a shared branch',
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description='Concurrent agent file-lock utility')
    sub = parser.add_subparsers(dest='command', required=True)

    claim = sub.add_parser('claim', help='Claim file locks for a branch')
    claim.add_argument('--branch', required=True, help='Owner branch name (e.g., agent/foo/...)')
    add_agent_arg(claim)
    claim.add_argument(
        '--allow-delete',
        action='store_true',
        help='Mark these files as explicitly approved for deletion by this branch',
    )
    claim.add_argument('files', nargs='+', help='Files to claim (repo-relative or absolute)')

    allow_delete = sub.add_parser('allow-delete', help='Enable delete approval on already claimed files')
    allow_delete.add_argument('--branch', required=True, help='Owner branch name')
    add_agent_arg(allow_delete)
    allow_delete.add_argument('files', nargs='+', help='Files to mark as delete-approved')

    release = sub.add_parser('release', help='Release file locks for a branch')
    release.add_argument('--branch', required=True, help='Owner branch name')
    add_agent_arg(release)
    release.add_argument('files', nargs='*', help='Optional files; omit to release all branch locks')

    status = sub.add_parser('status', help='Show lock status')
    status.add_argument('--branch', help='Filter by branch')
    add_agent_arg(status)

    validate = sub.add_parser('validate', help='Validate staged files are locked by branch')
    validate.add_argument('--branch', required=True, help='Owner branch name')
    add_agent_arg(validate)
    validate.add_argument('--staged', action='store_true', help='Validate staged files from git index')
    validate.add_argument('files', nargs='*', help='Files to validate when --staged is not used')

    return parser


def dispatch_command(args: argparse.Namespace, repo_root: Path) -> int:
    if args.command == 'claim':
        return cmd_claim(args, repo_root)
    if args.command == 'allow-delete':
        return cmd_allow_delete(args, repo_root)
    if args.command == 'release':
        return cmd_release(args, repo_root)
    if args.command == 'status':
        return cmd_status(args, repo_root)
    if args.command == 'validate':
        if not args.staged and not args.files:
            raise LockError('validate requires --staged or one or more file paths')
        return cmd_validate(args, repo_root)
    raise LockError(f'Unknown command: {args.command}')


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        repo_root = resolve_repo_root()
        # Serialize state-changing commands (and validate's snapshot read) across
        # ALL worktrees with one shared lock, so concurrent runs can't clobber
        # each other or both win the same file. status is a pure read -> unlocked.
        if args.command in {'claim', 'allow-delete', 'release', 'validate'}:
            with cross_worktree_lock(repo_root):
                return dispatch_command(args, repo_root)
        return dispatch_command(args, repo_root)
    except LockError as exc:
        print(f'[agent-file-locks] {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
