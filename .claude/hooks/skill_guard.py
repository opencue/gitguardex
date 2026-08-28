#!/usr/bin/env python3
"""PreToolUse hook — enforce guardrail skills before Bash/Edit/Write operations."""

import json
import os
import re
import shlex
import subprocess
import sys
import time
from fnmatch import fnmatch
from pathlib import Path

try:
    import fcntl
except ImportError:  # non-POSIX: exclusive adaptive sessions must fail closed
    fcntl = None

try:
    from _analytics import emit_event
except ImportError:

    def emit_event(*_a: object, **_k: object) -> None:
        pass


MAIN_RS_REL_PATH = "rust/codex-lb-runtime/src/main.rs"
MAIN_RS_LOCK_REL_PATH = ".omx/locks/rust-main-rs.lock.json"
PROTECTED_BRANCHES = {"dev", "main", "master"}
DEFAULT_MAIN_RS_INTEGRATOR_AGENT = os.environ.get("MAIN_RS_INTEGRATOR_AGENT", "integrator")
PROTECTED_BRANCH_EDIT_OVERRIDE_ENV = "ALLOW_CODE_EDIT_ON_PROTECTED_BRANCH"
SHELL_GUARD_OVERRIDE_ENV = "ALLOW_BASH_ON_NON_AGENT_BRANCH"
PRIMARY_WORKTREE_AGENT_EDIT_OVERRIDE_ENV = "ALLOW_CODE_EDIT_ON_PRIMARY_WORKTREE"
ADAPTIVE_SESSION_LEASE_SECONDS_ENV = "GUARDEX_ADAPTIVE_SESSION_LEASE_SEC"
DEFAULT_ADAPTIVE_SESSION_LEASE_SECONDS = 900.0
# Branch namespace policy.
#
# By default ANY branch that is not a protected base (main/dev/master, plus any
# repo-configured protected branch) counts as agent-managed and is safe to edit
# or commit on. The load-bearing rule is only that you are OFF the protected
# base, so `vendor/x`, `feat/y`, or any ad-hoc name works without ceremony.
#
# Lockdown mode: set GUARDEX_AGENT_BRANCH_PREFIXES_ONLY=1 to restrict
# agent-managed branches to an explicit GUARDEX_AGENT_BRANCH_PREFIXES allowlist
# (comma- or space-separated). The defaults below cover the common agentic-CLI
# namespaces and seed that allowlist in lockdown mode:
#   - "agent/"   — Guardex / Codex / generic agent branches
#   - "claude/"  — Claude Code session branches (e.g. claude/improve-X-Segmk)
#   - "codex/"   — Codex Cloud session branches
#   - "cursor/"  — Cursor background-agent branches
AGENT_BRANCH_PREFIXES_ENV = "GUARDEX_AGENT_BRANCH_PREFIXES"
AGENT_BRANCH_PREFIXES_EXCLUSIVE_ENV = "GUARDEX_AGENT_BRANCH_PREFIXES_ONLY"
DEFAULT_AGENT_BRANCH_PREFIXES = ("agent/", "claude/", "codex/", "cursor/")
PATCH_FILE_HEADER_RE = re.compile(
    r"^\*\*\* (?:Update|Add|Delete) File:\s+(.+?)\s*$",
    re.MULTILINE,
)

SHELL_ENV_PREFIX_RE = re.compile(r"^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+")
SHELL_OUTPUT_REDIRECT_TOKENS = {">", ">>", ">|", "&>", "&>>", ">&", ">>&"}
SHELL_OUTPUT_REDIRECT_FALLBACK_RE = re.compile(
    r"(^|\s)(?:&>>|&>|[0-9]*(?:>\||>>|>|>&|>>&))"
)
SHELL_ALLOWED_SEGMENTS = (
    re.compile(r"^(?:cd|pwd|true|false|echo|printf|export|unset|set(?:\s+-[A-Za-z-]+)?)\b"),
    # Read-only version probes: harmless, frequent on session start.
    re.compile(r"^(?:node|npm|pnpm|yarn|python|python3|ruby|go|java|cargo|rustc|deno|bun)\s+--version\b"),
    re.compile(r"^(?:node|npm|pnpm|yarn|python|python3|ruby|go|java|cargo|rustc|deno|bun)\s+-v\b"),
    re.compile(r"^git\s+(?:status|rev-parse|symbolic-ref|branch|log|show|diff|fetch|remote|config\s+--get|worktree\s+list|ls-files|submodule\s+status|stash\s+(?:list|show))\b"),
    # Safe sync: fast-forward / rebase pulls cannot move primary onto a divergent state.
    re.compile(r"^git\s+pull(?:\s+--ff-only|\s+--rebase|\s+origin\s+\S+)?\s*$"),
    re.compile(r"^git\s+pull\s+--ff-only(?:\s+\S+){0,2}\s*$"),
    re.compile(r"^git\s+pull\s+--rebase(?:\s+\S+){0,2}\s*$"),
    # Pushing/checking out branches in any recognized agent namespace is safe.
    # The capture group lists each default prefix; extra prefixes from
    # GUARDEX_AGENT_BRANCH_PREFIXES are honored at branch-detection time, so
    # these regexes only need to cover the built-in namespaces.
    re.compile(r"^git\s+push(?:\s+(?:-u|--set-upstream))?\s+\S+\s+(?:agent|claude|codex|cursor)/[^\s]+(?:\s|$)"),
    re.compile(r"^git\s+push(?:\s+(?:-u|--set-upstream))?\s+\S+\s+HEAD:(?:agent|claude|codex|cursor)/[^\s]+(?:\s|$)"),
    re.compile(
        r"^gh\s+(?:auth\s+status|repo\s+view|pr\s+(?:list|view|checks|status|create|edit|comment|review|ready|reopen|merge)|issue\s+(?:list|view|status|create|comment)|run\s+(?:list|view|watch)|workflow\s+(?:list|view|run))\b"
    ),
    re.compile(r"^git\s+(?:checkout|switch)\s+(?:agent|claude|codex|cursor)/[^\s]+(?:\s|$)"),
    re.compile(r"^(?:ls|cat|head|tail|wc|nl|sed\s+-n|rg|find|stat|du|df|ps|ss|which|command\s+-v)\b"),
    # All gitguardex CLI subcommands are themselves safety-aware; trust them on protected branches.
    re.compile(r"^(?:gx|guardex|gitguardex|multiagent-safety)\s+\S+\b"),
    re.compile(r"^python3?\s+scripts/(?:agent-file-locks\.py|main_rs_lock\.py)\s+(?:status|list|validate)\b"),
    re.compile(
        r"^(?:bash\s+)?(?:(?:\.{1,2}/)?scripts|(?:/|~)[^\s]*/scripts)/(?:agent-branch-start\.sh|agent-branch-finish\.sh|agent-pivot\.sh|codex-agent\.sh|install-agent-git-hooks\.sh)\b"
    ),
)

ADAPTIVE_DIRECT_SHELL_ALLOWED_SEGMENTS = (
    re.compile(r"^git\s+(?:add|commit|push)(?:\s|$)"),
    re.compile(r"^(?:npm|pnpm|yarn|bun)\s+(?:test|run\s+(?:build|check|lint|test|typecheck|verify))(?:\s|$)"),
    re.compile(r"^(?:pytest|ruff|mypy|pyright|tsc|eslint|biome)(?:\s|$)"),
    re.compile(r"^python3?\s+-m\s+(?:pytest|ruff|mypy)(?:\s|$)"),
    re.compile(r"^cargo\s+(?:build|check|clippy|fmt|test)(?:\s|$)"),
    re.compile(r"^go\s+(?:build|test|vet)(?:\s|$)"),
)


def load_skill_rules() -> dict:
    """Load skill-rules.json relative to this hook's location."""
    hook_dir = Path(__file__).resolve().parent
    rules_path = hook_dir.parent / "skills" / "skill-rules.json"
    with open(rules_path) as f:
        return json.load(f)


def load_session_state(session_id: str) -> dict:
    """Load session state for tracking which skills have been used."""
    hook_dir = Path(__file__).resolve().parent
    state_path = hook_dir / "state" / f"skills-used-{session_id}.json"
    if state_path.exists():
        try:
            with open(state_path) as f:
                return json.load(f)
        except (json.JSONDecodeError, ValueError):
            pass
    return {"suggestedSkills": [], "usedSkills": []}


def match_path_patterns(file_path: str, patterns: list[str]) -> bool:
    """Check if file_path matches any glob pattern."""
    return any(fnmatch(file_path, pat) for pat in patterns)


def match_content_patterns(file_path: str, patterns: list[str]) -> bool:
    """Check if file content matches any regex pattern."""
    try:
        content = Path(file_path).read_text(errors="ignore")
        return any(re.search(pat, content) for pat in patterns)
    except (FileNotFoundError, PermissionError):
        return False


def check_pass_state(pass_state_file: str) -> bool:
    """Check if a pass state file exists and has result=PASS."""
    hook_dir = Path(__file__).resolve().parent
    state_path = hook_dir / "state" / pass_state_file
    if not state_path.exists():
        return False
    try:
        data = json.loads(state_path.read_text())
        return data.get("result") == "PASS"
    except (json.JSONDecodeError, PermissionError):
        return False


def check_file_markers(file_path: str, markers: list[str]) -> bool:
    """Check if file contains any skip markers."""
    try:
        content = Path(file_path).read_text(errors="ignore")
        return any(marker in content for marker in markers)
    except (FileNotFoundError, PermissionError):
        return False


def find_repo_root(file_path: str) -> Path:
    """Resolve repository root by walking up from file path until .git is found."""
    candidate = Path(file_path).resolve()
    for parent in [candidate, *candidate.parents]:
        git_dir = parent / ".git"
        if git_dir.exists():
            return parent
    return Path.cwd()


def normalize_path(value: str) -> str:
    return value.replace("\\", "/")


def resolve_repo_root(file_path: str, cwd: str) -> Path:
    # The GUARDED repo is the one the session is working in (cwd), not whatever
    # repo the target file happens to live in. Resolve from cwd first so a hook
    # installed in repo A never applies A's branch protection to a file inside an
    # unrelated repo B — e.g. a version-controlled `~/.claude/.../memory` dir that
    # is its own git repo on its own `main` branch. `path_within_repo` then keeps
    # cross-repo / out-of-repo targets out of scope.
    if cwd:
        return find_repo_root(cwd)
    if file_path:
        return find_repo_root(file_path)
    return Path.cwd()


def resolve_target_path(target: str, repo_root: Path, cwd: str) -> Path:
    """Absolute, canonicalized path for a tool target.

    Relative targets resolve against the session cwd (which is inside the repo),
    absolute targets are taken as-is; both are `.resolve()`d so `..`/symlinks are
    canonicalized. Shared by containment checks and per-target branch resolution
    so they agree on exactly which file an edit lands on.
    """
    candidate = Path(target).expanduser()
    if not candidate.is_absolute():
        base = Path(cwd) if cwd else repo_root
        candidate = base / candidate
    return candidate.resolve()


def path_within_repo(target: str, repo_root: Path, cwd: str) -> bool:
    """True when `target` resolves to a path inside the guarded repo working tree.

    The edit guard exists to protect the repo's checkout. A write to a file that
    is NOT inside the repo (e.g. `~/.claude/.../memory/*.md`, `/tmp` scratch)
    cannot touch the protected branch, so it must never be blocked — even when
    the current cwd's repo happens to be on a protected branch. Relative targets
    resolve against the session cwd (which is inside the repo); absolute targets
    outside the repo return False. Both sides are `.resolve()`d, so `..` and
    symlinks are canonicalized before the containment check — a symlink inside
    the repo that points OUT (e.g. `<repo>/link -> /etc`) is intentionally
    treated as out-of-repo, since the write lands outside the protected tree.
    """
    if not target:
        return False
    try:
        candidate = resolve_target_path(target, repo_root, cwd)
        candidate.relative_to(Path(repo_root).resolve())
        return True
    except (ValueError, OSError):
        return False


def normalize_guardex_toggle(raw: str | None) -> bool | None:
    if raw is None:
        return None
    normalized = raw.strip().lower()
    if not normalized:
        return None
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return None


def read_repo_dotenv_var(repo_root: Path, name: str) -> str | None:
    env_path = repo_root / ".env"
    if not env_path.exists():
        return None
    pattern = re.compile(rf"^\s*(?:export\s+)?{re.escape(name)}\s*=\s*(.*)$")
    try:
        lines = env_path.read_text(errors="ignore").splitlines()
    except OSError:
        return None
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = pattern.match(line)
        if not match:
            continue
        value = re.sub(r"\s+#.*$", "", match.group(1)).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        return value
    return None


def guardex_repo_is_enabled(repo_root: Path) -> bool:
    env_value = normalize_guardex_toggle(os.environ.get("GUARDEX_ON"))
    if env_value is not None:
        return env_value
    dotenv_value = normalize_guardex_toggle(read_repo_dotenv_var(repo_root, "GUARDEX_ON"))
    if dotenv_value is not None:
        return dotenv_value
    return True


def guardex_worktree_mode(repo_root: Path) -> str:
    raw = os.environ.get("GUARDEX_WORKTREE_MODE")
    if not raw:
        raw = read_repo_dotenv_var(repo_root, "GUARDEX_WORKTREE_MODE")
    if not raw:
        try:
            result = subprocess.run(
                ["git", "config", "--local", "--get", "multiagent.worktreeMode"],
                cwd=repo_root,
                env=_clean_git_env(),
                check=False,
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                raw = result.stdout.strip()
        except OSError:
            raw = ""
    return "adaptive" if (raw or "").strip().lower() == "adaptive" else "always"


def _clean_git_env() -> dict[str, str]:
    env = dict(os.environ)
    for name in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX"):
        env.pop(name, None)
    return env


def has_shared_agent_activity(repo_root: Path) -> bool:
    try:
        if "GUARDEX_SHARED_STATE" in os.environ:
            mode = os.environ.get("GUARDEX_SHARED_STATE", "")
        else:
            mode_result = subprocess.run(
                ["git", "config", "--local", "--get", "multiagent.sharedState"],
                cwd=repo_root,
                env=_clean_git_env(),
                check=False,
                capture_output=True,
                text=True,
            )
            if mode_result.returncode not in {0, 1}:
                return True
            mode = mode_result.stdout.strip() if mode_result.returncode == 0 else ""
        if mode.strip().lower() != "git":
            return False

        if "GUARDEX_SHARED_STATE_REMOTE" in os.environ:
            remote = os.environ.get("GUARDEX_SHARED_STATE_REMOTE", "")
        else:
            remote_result = subprocess.run(
                ["git", "config", "--local", "--get", "multiagent.sharedStateRemote"],
                cwd=repo_root,
                env=_clean_git_env(),
                check=False,
                capture_output=True,
                text=True,
            )
            if remote_result.returncode not in {0, 1}:
                return True
            remote = remote_result.stdout.strip() if remote_result.returncode == 0 else "origin"
        remote = remote.strip() or "origin"
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,127}", remote):
            return True

        shared = subprocess.run(
            [
                "git",
                "ls-remote",
                "--refs",
                remote,
                "refs/gitguardex/locks/*",
            ],
            cwd=repo_root,
            env=_clean_git_env(),
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return True
    return shared.returncode != 0 or bool(shared.stdout.strip())


def has_competing_worktree_activity(repo_root: Path) -> bool:
    if has_shared_agent_activity(repo_root):
        return True
    try:
        result = subprocess.run(
            ["git", "worktree", "list", "--porcelain"],
            cwd=repo_root,
            env=_clean_git_env(),
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return True
    if result.returncode != 0:
        return True

    primary = repo_root.resolve()
    worktrees = [
        Path(line.removeprefix("worktree ")).resolve()
        for line in result.stdout.splitlines()
        if line.startswith("worktree ")
    ]
    for worktree in worktrees:
        if worktree == primary or not worktree.is_dir():
            continue
        try:
            dirty = subprocess.run(
                ["git", "status", "--porcelain", "--untracked-files=normal"],
                cwd=worktree,
                env=_clean_git_env(),
                check=False,
                capture_output=True,
                text=True,
            )
        except OSError:
            return True
        if dirty.returncode != 0:
            return True
        dirty_paths = [
            line[3:]
            for line in dirty.stdout.splitlines()
            if len(line) > 3
            and not line[3:].startswith(".omx/")
            and not line[3:].startswith(".omc/")
        ]
        if dirty_paths:
            return True

        lock_path = worktree / ".omx" / "state" / "agent-file-locks.json"
        try:
            lock_data = json.loads(lock_path.read_text())
        except FileNotFoundError:
            continue
        except (OSError, json.JSONDecodeError, ValueError):
            return True
        if not isinstance(lock_data, dict):
            return True
        locks = lock_data.get("locks")
        if locks is not None and not isinstance(locks, dict):
            return True
        if locks:
            return True
    return False


def target_has_file_lock(repo_root: Path, file_path: str, session_id: str) -> bool:
    """Fail closed when any foreign local registry claims the edit target."""
    try:
        relative_path = Path(file_path).resolve().relative_to(repo_root.resolve()).as_posix()
    except (OSError, ValueError):
        return False
    try:
        worktree_result = subprocess.run(
            ["git", "worktree", "list", "--porcelain"],
            cwd=repo_root,
            env=_clean_git_env(),
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return True
    if worktree_result.returncode != 0:
        return True

    for line in worktree_result.stdout.splitlines():
        if not line.startswith("worktree "):
            continue
        lock_path = Path(line.removeprefix("worktree ")) / ".omx" / "state" / "agent-file-locks.json"
        try:
            lock_data = json.loads(lock_path.read_text())
        except FileNotFoundError:
            continue
        except (OSError, json.JSONDecodeError, ValueError):
            return True
        if not isinstance(lock_data, dict):
            return True
        locks = lock_data.get("locks", {})
        if not isinstance(locks, dict):
            return True
        branch = current_branch(repo_root)
        target_prefix = "" if relative_path == "." else f"{relative_path.rstrip('/')}/"
        locked_paths = {
            path.rstrip("/")
            for path, owner in locks.items()
            if not isinstance(owner, dict)
            or str(owner.get("branch", "")) != branch
            or (
                owner.get("agent")
                and str(owner.get("agent")) != session_id
            )
        }
        ancestor_claimed = any(
            locked_path in {"", "."}
            or relative_path == locked_path
            or relative_path.startswith(f"{locked_path}/")
            for locked_path in locked_paths
        )
        if ancestor_claimed or (
            target_prefix and any(path.startswith(target_prefix) for path in locked_paths)
        ) or (not target_prefix and locked_paths):
            return True
    return False


def adaptive_git_lock_error(
    repo_root: Path,
    command: str,
    session_id: str,
    command_cwd: str = "",
) -> str | None:
    """Reject adaptive staging/commits that can touch a claimed path."""
    for segment in split_shell_segments(command):
        tokens = shell_segment_tokens(normalize_shell_segment(segment))
        if len(tokens) < 2 or Path(tokens[0]).name != "git":
            continue
        subcommand = tokens[1]
        if subcommand == "add":
            targets: list[str] = []
            after_separator = False
            unbounded_pathspec = False
            index = 2
            while index < len(tokens):
                token = tokens[index]
                if after_separator:
                    targets.append(token)
                elif token == "--":
                    after_separator = True
                elif token in {"-A", "--all", "-u", "--update"}:
                    pass
                elif token in {"--chmod", "--pathspec-from-file"}:
                    index += 1
                    if token == "--pathspec-from-file":
                        unbounded_pathspec = True
                elif token.startswith("--pathspec-from-file="):
                    unbounded_pathspec = True
                elif token.startswith("-"):
                    pass
                elif token.startswith(":"):
                    unbounded_pathspec = True
                else:
                    targets.append(token)
                index += 1
            if not targets or unbounded_pathspec:
                targets.append(str(repo_root))
            for target in targets:
                target_path = Path(target)
                if not target_path.is_absolute():
                    target_path = Path(command_cwd or repo_root) / target_path
                if target_has_file_lock(repo_root, str(target_path), session_id):
                    return (
                        "BLOCKED: Adaptive git add target is claimed by another agent lane.\n"
                        "Inspect `gx mcp who-owns <file>`, then wait for release or open an isolated lane."
                    )
        elif subcommand == "commit":
            arguments = tokens[2:]
            option_values = {
                "-C",
                "-F",
                "-c",
                "-m",
                "-t",
                "--author",
                "--cleanup",
                "--date",
                "--file",
                "--fixup",
                "--message",
                "--reedit-message",
                "--reuse-message",
                "--squash",
                "--template",
                "--trailer",
            }
            include_all_worktree = False
            pathspecs: list[str] = []
            after_separator = False
            skip_value = False
            for argument in arguments:
                if skip_value:
                    skip_value = False
                elif after_separator:
                    pathspecs.append(argument)
                elif argument == "--":
                    after_separator = True
                elif argument in option_values:
                    skip_value = True
                elif argument in {"-a", "--all"}:
                    include_all_worktree = True
                elif argument == "--pathspec-from-file":
                    include_all_worktree = True
                    skip_value = True
                elif argument.startswith("--pathspec-from-file="):
                    include_all_worktree = True
                elif re.fullmatch(
                    r"-[npqsvio]*a[npqsvio]*(?:[mS].*)?", argument
                ) is not None:
                    include_all_worktree = True
                elif not argument.startswith("-"):
                    pathspecs.append(argument)
            changed_paths: set[str] = set()
            diff_commands = [
                ["git", "diff", "--cached", "--no-renames", "--name-only", "-z"]
            ]
            if include_all_worktree:
                diff_commands.append(["git", "diff", "--no-renames", "--name-only", "-z"])
            elif pathspecs:
                normalized_pathspecs: list[str] = []
                for pathspec in pathspecs:
                    if pathspec.startswith(":"):
                        include_all_worktree = True
                        break
                    candidate = Path(pathspec)
                    if not candidate.is_absolute():
                        candidate = Path(command_cwd or repo_root) / candidate
                    try:
                        relative = candidate.resolve().relative_to(repo_root.resolve()).as_posix()
                    except (OSError, ValueError):
                        include_all_worktree = True
                        break
                    if relative == ".":
                        include_all_worktree = True
                        break
                    normalized_pathspecs.append(relative)
                if include_all_worktree:
                    diff_commands.append(
                        ["git", "diff", "--no-renames", "--name-only", "-z"]
                    )
                elif normalized_pathspecs:
                    diff_commands.append(
                        [
                            "git",
                            "diff",
                            "--no-renames",
                            "--name-only",
                            "-z",
                            "--",
                            *normalized_pathspecs,
                        ]
                    )
            for diff_args in diff_commands:
                try:
                    changed = subprocess.run(
                        diff_args,
                        cwd=repo_root,
                        env=_clean_git_env(),
                        check=False,
                        capture_output=True,
                        text=True,
                    )
                except OSError:
                    return "BLOCKED: Adaptive commit cannot validate changed file ownership."
                if changed.returncode != 0:
                    return "BLOCKED: Adaptive commit cannot validate changed file ownership."
                changed_paths.update(path for path in changed.stdout.split("\0") if path)
            for changed_path in changed_paths:
                if target_has_file_lock(repo_root, str(repo_root / changed_path), session_id):
                    return (
                        "BLOCKED: Adaptive commit includes a file claimed by another agent lane.\n"
                        "Inspect `gx mcp who-owns <file>`, then wait for release or open an isolated lane."
                    )
    return None


def adaptive_primary_session_lease_error(
    repo_root: Path,
    session_id: str,
    *,
    claim: bool = True,
) -> str | None:
    """Return why this session cannot own adaptive direct work, or None.

    The lock file lives in the Git common dir, so every process operating on
    the primary checkout serializes the lease read/update. This closes the
    check-then-act race where two sessions could both observe no sibling
    worktree and start mutating the same protected checkout.

    ``claim=False`` is a read-only advisor probe: it reports a live foreign
    owner without reserving the checkout merely because a session started.
    """
    if not isinstance(session_id, str) or not session_id.strip() or session_id == "unknown":
        return "BLOCKED: Adaptive direct work requires a stable agent session id."
    if fcntl is None:
        return "BLOCKED: Adaptive direct work cannot acquire an exclusive OS session lease."

    raw_ttl = os.environ.get(ADAPTIVE_SESSION_LEASE_SECONDS_ENV, "").strip()
    try:
        ttl_seconds = float(raw_ttl) if raw_ttl else DEFAULT_ADAPTIVE_SESSION_LEASE_SECONDS
    except ValueError:
        return "BLOCKED: Adaptive direct work session lease TTL is invalid."
    if not (0 < ttl_seconds < float("inf")):
        return "BLOCKED: Adaptive direct work session lease TTL must be positive and finite."

    common_dir = git_common_dir(repo_root)
    if not common_dir:
        return "BLOCKED: Adaptive direct work cannot resolve the shared Git directory."
    state_dir = Path(common_dir) / "gitguardex"
    lease_path = state_dir / "adaptive-direct-session.json"
    lock_path = state_dir / "adaptive-direct-session.lock"
    try:
        state_dir.mkdir(parents=True, exist_ok=True)
        lock_handle = open(lock_path, "a+")
    except OSError:
        return "BLOCKED: Adaptive direct work cannot open its exclusive session lease."

    acquired = False
    try:
        try:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except BlockingIOError:
            return (
                "BLOCKED: Adaptive direct work is owned by another active agent session "
                "in this checkout."
            )
        except OSError:
            return "BLOCKED: Adaptive direct work cannot lock its exclusive session lease."

        lease: dict = {}
        try:
            lease = json.loads(lease_path.read_text())
        except FileNotFoundError:
            pass
        except (OSError, json.JSONDecodeError, ValueError):
            return "BLOCKED: Adaptive direct work session lease state is unreadable."
        if not isinstance(lease, dict):
            return "BLOCKED: Adaptive direct work session lease state is malformed."

        owner = lease.get("session_id")
        last_seen = lease.get("last_seen_epoch")
        if owner is not None and not isinstance(owner, str):
            return "BLOCKED: Adaptive direct work session lease owner is malformed."
        if last_seen is not None and (
            isinstance(last_seen, bool) or not isinstance(last_seen, (int, float))
        ):
            return "BLOCKED: Adaptive direct work session lease timestamp is malformed."

        now = time.time()
        foreign_is_live = bool(
            owner
            and owner != session_id
            and last_seen is not None
            and now - float(last_seen) < ttl_seconds
        )
        if foreign_is_live:
            return (
                "BLOCKED: Adaptive direct work is owned by another active agent session "
                "in this checkout.\n"
                "Wait for that session to finish or open an isolated lane:\n"
                '  gx branch start --new --no-transfer "<task>" "<agent-name>"'
            )

        if claim:
            tmp_path = lease_path.with_suffix(f".json.tmp-{os.getpid()}")
            try:
                tmp_path.write_text(
                    json.dumps(
                        {
                            "session_id": session_id,
                            "last_seen_epoch": now,
                        },
                        sort_keys=True,
                    )
                    + "\n"
                )
                os.replace(tmp_path, lease_path)
            except OSError:
                try:
                    tmp_path.unlink()
                except OSError:
                    pass
                return "BLOCKED: Adaptive direct work cannot update its exclusive session lease."
        return None
    finally:
        try:
            if acquired:
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
        finally:
            lock_handle.close()


def adaptive_command_lock_tool_input(
    repo_root: Path,
    tool_input: dict,
    session_id: str,
) -> dict | None:
    """Wrap an adaptive Bash command so its session lock spans execution."""
    command = tool_input.get("command")
    if not isinstance(command, str) or not command.strip():
        return None
    if (
        os.environ.get(PROTECTED_BRANCH_EDIT_OVERRIDE_ENV) == "1"
        or os.environ.get(SHELL_GUARD_OVERRIDE_ENV) == "1"
        or fcntl is None
        or current_branch(repo_root) not in resolve_protected_branches(repo_root)
        or guardex_worktree_mode(repo_root) != "adaptive"
    ):
        return None
    common_dir = git_common_dir(repo_root)
    if not common_dir:
        return None
    state_dir = Path(common_dir) / "gitguardex"
    lock_path = state_dir / "adaptive-direct-session.lock"
    lease_path = state_dir / "adaptive-direct-session.json"
    wrapper = " ".join(
        shlex.quote(value)
        for value in (
            sys.executable,
            str(Path(__file__).resolve()),
            "--adaptive-command-lock",
            str(lock_path),
            str(lease_path),
            session_id,
            command,
        )
    )
    updated_input = dict(tool_input)
    updated_input["command"] = wrapper
    return updated_input


def run_with_adaptive_command_lock(
    lock_path: str,
    lease_path: str,
    session_id: str,
    command: str,
) -> None:
    """Execute one shell command while holding the checkout's adaptive lock."""
    if fcntl is None:
        print("Adaptive direct work requires POSIX file locking.", file=sys.stderr)
        sys.exit(126)
    try:
        lock_handle = open(lock_path, "a+")
    except OSError as error:
        print(f"Adaptive direct command lock failed: {error}", file=sys.stderr)
        sys.exit(126)
    with lock_handle:
        try:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Adaptive direct command lock is already owned.", file=sys.stderr)
            sys.exit(126)
        except OSError as error:
            print(f"Adaptive direct command lock failed: {error}", file=sys.stderr)
            sys.exit(126)
        try:
            lease = json.loads(Path(lease_path).read_text())
        except (OSError, json.JSONDecodeError, ValueError):
            print("Adaptive direct command lease is unreadable.", file=sys.stderr)
            sys.exit(126)
        if not isinstance(lease, dict) or lease.get("session_id") != session_id:
            print("Adaptive direct command lease owner changed before execution.", file=sys.stderr)
            sys.exit(126)
        try:
            completed = subprocess.run(command, shell=True, executable="/bin/bash")
        except OSError as error:
            print(f"Adaptive direct command execution failed: {error}", file=sys.stderr)
            sys.exit(126)
    sys.exit(completed.returncode)


def adaptive_direct_work_error(
    repo_root: Path,
    session_id: str,
    *,
    file_path: str = "",
) -> str | None:
    if guardex_worktree_mode(repo_root) != "adaptive":
        return None
    if has_competing_worktree_activity(repo_root):
        return (
            "BLOCKED: Adaptive direct work blocked: another agent lane has dirty files or locks.\n"
            "Inspect `gx mcp list-agents --no-prs`, then isolate this work:\n"
            '  gx branch start --new --no-transfer "<task>" "<agent-name>"'
        )
    if file_path and target_has_file_lock(repo_root, file_path, session_id):
        return (
            "BLOCKED: Adaptive direct work target is claimed by another agent lane.\n"
            "Inspect `gx mcp who-owns <file>`, then wait for release or open an isolated lane."
        )
    lease_error = adaptive_primary_session_lease_error(repo_root, session_id)
    return lease_error or ""


def current_branch(repo_root: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=repo_root,
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def resolve_protected_branches(repo_root: Path) -> set[str]:
    protected = set(PROTECTED_BRANCHES)
    raw = os.environ.get("GUARDEX_PROTECTED_BRANCHES", "").strip()
    if not raw:
        try:
            result = subprocess.run(
                ["git", "config", "--get", "multiagent.protectedBranches"],
                cwd=repo_root,
                check=False,
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                raw = result.stdout.strip()
        except OSError:
            raw = ""
    if raw:
        for token in raw.replace(",", " ").split():
            token = token.strip()
            if token:
                protected.add(token)
    return protected


def is_linked_worktree(repo_root: Path) -> bool:
    try:
        git_dir_result = subprocess.run(
            ["git", "rev-parse", "--git-dir"],
            cwd=repo_root,
            check=False,
            capture_output=True,
            text=True,
        )
        common_dir_result = subprocess.run(
            ["git", "rev-parse", "--git-common-dir"],
            cwd=repo_root,
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return False

    if git_dir_result.returncode != 0 or common_dir_result.returncode != 0:
        return False

    git_dir_value = git_dir_result.stdout.strip()
    common_dir_value = common_dir_result.stdout.strip()
    if not git_dir_value or not common_dir_value:
        return False

    git_dir_path = Path(git_dir_value)
    common_dir_path = Path(common_dir_value)
    if not git_dir_path.is_absolute():
        git_dir_path = (repo_root / git_dir_path).resolve()
    else:
        git_dir_path = git_dir_path.resolve()
    if not common_dir_path.is_absolute():
        common_dir_path = (repo_root / common_dir_path).resolve()
    else:
        common_dir_path = common_dir_path.resolve()

    return git_dir_path != common_dir_path


def git_common_dir(repo_root: Path) -> "str | None":
    """Absolute git common dir for a checkout, or None. Linked worktrees of the
    same repository share one common dir, so two checkouts belong to the SAME
    repo iff their common dirs match — used to tell a sibling agent worktree
    (judge by its own branch) apart from a nested independent repo/submodule
    (judge by the session branch)."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--git-common-dir"],
            cwd=repo_root,
            env=_clean_git_env(),
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return None
    if result.returncode != 0:
        return None
    value = result.stdout.strip()
    if not value:
        return None
    path = Path(value)
    if not path.is_absolute():
        path = Path(repo_root) / path
    return str(path.resolve())


def branch_agent_name(branch: str) -> str:
    parts = branch.split("/")
    if len(parts) >= 3 and parts[0] == "agent":
        return parts[1]
    return ""


def _parse_branch_prefixes(raw: str) -> tuple[str, ...]:
    """Split GUARDEX_AGENT_BRANCH_PREFIXES into normalized prefixes."""
    if not raw:
        return ()
    tokens = [token.strip() for token in re.split(r"[\s,]+", raw) if token.strip()]
    normalized: list[str] = []
    for token in tokens:
        # Ensure trailing slash so "claude" matches "claude/foo" but not
        # an unrelated branch named "claudette/foo".
        if not token.endswith("/"):
            token = token + "/"
        normalized.append(token)
    return tuple(normalized)


def _exclusive_prefix_mode() -> bool:
    """True when GUARDEX_AGENT_BRANCH_PREFIXES_ONLY restricts to an allowlist."""
    return os.environ.get(AGENT_BRANCH_PREFIXES_EXCLUSIVE_ENV, "").strip().lower() in {
        "1", "true", "yes", "on",
    }


def agent_branch_prefixes() -> tuple[str, ...]:
    """Agent-branch prefix allowlist used in lockdown mode.

    Returns defaults plus GUARDEX_AGENT_BRANCH_PREFIXES. When
    GUARDEX_AGENT_BRANCH_PREFIXES_ONLY=1 the defaults are dropped so only the
    explicit env list is used. Only consulted when _exclusive_prefix_mode() is
    on; the default policy (any non-protected branch) ignores prefixes.
    """
    extras = _parse_branch_prefixes(os.environ.get(AGENT_BRANCH_PREFIXES_ENV, ""))
    base = () if _exclusive_prefix_mode() else DEFAULT_AGENT_BRANCH_PREFIXES
    seen: set[str] = set()
    out: list[str] = []
    for prefix in (*base, *extras):
        if prefix not in seen:
            seen.add(prefix)
            out.append(prefix)
    return tuple(out)


def is_agent_branch(branch: str, protected: "set[str] | None" = None) -> bool:
    """Treat a branch as agent-managed (safe to edit/commit on).

    Default policy: any non-empty branch that is NOT a protected base counts as
    agent-managed, so `vendor/x`, `feat/y`, or any ad-hoc name works. Callers
    pass the repo-resolved protected set so git-config / env-configured bases are
    honored; when omitted, the static PROTECTED_BRANCHES (main/dev/master) apply.

    Lockdown policy (GUARDEX_AGENT_BRANCH_PREFIXES_ONLY=1): restrict to the
    agent_branch_prefixes() allowlist instead.
    """
    if not branch:
        return False
    if _exclusive_prefix_mode():
        return any(branch.startswith(prefix) for prefix in agent_branch_prefixes())
    bases = PROTECTED_BRANCHES if protected is None else protected
    return branch not in bases


def is_codex_session() -> bool:
    """Best-effort detection for Codex/OMX automated sessions."""
    return bool(
        os.environ.get("CODEX_THREAD_ID")
        or os.environ.get("OMX_SESSION_ID")
        or os.environ.get("CODEX_CI") == "1"
    )


def ensure_protected_branch_edit_allowed(
    file_path: str,
    session_id: str = "unknown",
    target_file_path: str = "",
) -> str | None:
    """Block Codex edits on non-agent branches and all edits on protected branches."""
    if os.environ.get(PROTECTED_BRANCH_EDIT_OVERRIDE_ENV) == "1":
        return None
    repo_root = find_repo_root(file_path)
    branch = current_branch(repo_root)
    protected = resolve_protected_branches(repo_root)
    if branch in protected:
        adaptive_error = adaptive_direct_work_error(
            repo_root,
            session_id,
            file_path=target_file_path or file_path,
        )
        if adaptive_error == "":
            return None
        if adaptive_error:
            return adaptive_error
    if is_agent_branch(branch, protected):
        return None

    if branch in PROTECTED_BRANCHES:
        blocked_scope = f"protected branch '{branch}'"
    elif is_codex_session():
        blocked_scope = f"non-agent branch '{branch or 'HEAD'}'"
    else:
        return None

    return (
        f"BLOCKED: Agent edit attempted on {blocked_scope}.\n"
        "Open an isolated agent worktree (single command, dirty tree migrates with you):\n"
        '  gx branch start "<task>" "<agent-name>"\n'
        "Then `cd` into the printed WORKTREE_PATH and retry the edit.\n"
        "Equivalent legacy form:\n"
        '  bash scripts/agent-branch-start.sh "<task>" "<agent-name>"\n'
        "Override (must be exported in the harness env, not as a command prefix):\n"
        f"  export {PROTECTED_BRANCH_EDIT_OVERRIDE_ENV}=1"
    )


def extract_shell_command(tool_input: dict) -> str:
    for key in ("cmd", "command", "script", "input"):
        value = tool_input.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def normalize_shell_segment(segment: str) -> str:
    trimmed = segment.strip()
    if not trimmed:
        return ""
    try:
        tokens = shlex.split(trimmed, posix=True)
    except ValueError:
        tokens = []
    if tokens:
        while tokens and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=.*$", tokens[0]):
            tokens.pop(0)
        if tokens:
            return " ".join(tokens)
    return SHELL_ENV_PREFIX_RE.sub("", trimmed).strip()


def split_shell_segments(command: str) -> list[str]:
    normalized = command.strip()
    if not normalized:
        return []

    try:
        lexer = shlex.shlex(normalized, posix=True, punctuation_chars="|&;")
        lexer.whitespace_split = True
        lexer.commenters = ""
        tokens = list(lexer)
    except ValueError:
        return [
            segment
            for segment in re.split(r"\s*(?:&&|\|\||;|\|)\s*", normalized)
            if segment.strip()
        ]

    segments: list[str] = []
    current: list[str] = []
    split_tokens = {"&&", "||", ";", "|"}
    for token in tokens:
        if token in split_tokens:
            if current:
                segments.append(" ".join(current))
                current = []
            continue
        current.append(token)
    if current:
        segments.append(" ".join(current))
    return segments


def shell_segment_tokens(segment: str) -> list[str]:
    try:
        lexer = shlex.shlex(segment, posix=True, punctuation_chars="|&;<>")
        lexer.whitespace_split = True
        lexer.commenters = ""
        return list(lexer)
    except ValueError:
        return []


def shell_segment_has_output_redirection(segment: str) -> bool:
    tokens = shell_segment_tokens(segment)
    if not tokens:
        return bool(SHELL_OUTPUT_REDIRECT_FALLBACK_RE.search(segment))
    for index, token in enumerate(tokens):
        if token not in SHELL_OUTPUT_REDIRECT_TOKENS:
            continue
        target = tokens[index + 1] if index + 1 < len(tokens) else ""
        if target == "&" and index + 2 < len(tokens) and tokens[index + 2].isdigit():
            continue
        if token in {">&", ">>&"} and target.isdigit():
            continue
        if target == "/dev/null":
            continue
        return True
    return False


def is_allowed_non_agent_shell_command(command: str) -> bool:
    normalized = command.strip()
    if not normalized:
        return True
    segments = split_shell_segments(normalized)
    if not segments:
        return True
    for raw_segment in segments:
        if shell_segment_has_output_redirection(raw_segment):
            return False
        segment = normalize_shell_segment(raw_segment)
        if not segment:
            continue
        if any(pattern.match(segment) for pattern in SHELL_ALLOWED_SEGMENTS):
            continue
        return False
    return True


def is_allowed_adaptive_direct_shell_command(command: str) -> bool:
    normalized = command.strip()
    if re.search(r"`|\$|[<>]\(|[*?\[\]{}]", normalized):
        return False
    segments = split_shell_segments(normalized)
    if not segments:
        return True
    for raw_segment in segments:
        if shell_segment_has_output_redirection(raw_segment):
            return False
        segment = normalize_shell_segment(raw_segment)
        if not segment:
            continue
        if not any(pattern.match(segment) for pattern in ADAPTIVE_DIRECT_SHELL_ALLOWED_SEGMENTS):
            return False
    return True


def is_unsafe_primary_git_command(repo_root: Path, command: str) -> bool:
    options_with_values = {
        "-C",
        "-c",
        "--config-env",
        "--exec-path",
        "--git-dir",
        "--namespace",
        "--super-prefix",
        "--work-tree",
    }
    for segment in split_shell_segments(command):
        tokens = shell_segment_tokens(normalize_shell_segment(segment))
        if not tokens:
            continue
        index = 0
        while index < len(tokens) and tokens[index] in {"command", "builtin", "exec"}:
            index += 1
            while index < len(tokens) and tokens[index].startswith("-"):
                index += 1
        if index < len(tokens) and Path(tokens[index]).name == "env":
            index += 1
            while index < len(tokens):
                token = tokens[index]
                if token == "--":
                    index += 1
                    break
                if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=.*$", token):
                    index += 1
                    continue
                if token in {"-S", "--split-string"} or token.startswith(
                    ("-S", "--split-string=")
                ):
                    return True
                if token in {"-u", "--unset", "-C", "--chdir", "-a", "--argv0"}:
                    index += 2
                    continue
                if token.startswith(
                    ("-u", "--unset=", "-C", "--chdir=", "--argv0=")
                ):
                    index += 1
                    continue
                if token.startswith("-"):
                    index += 1
                    continue
                break
        if index >= len(tokens) or Path(tokens[index]).name != "git":
            if index < len(tokens):
                executable = Path(tokens[index]).name
                shell_options = tokens[index + 1 :]
                if executable == "eval" or (
                    executable in {"bash", "dash", "fish", "ksh", "sh", "zsh"}
                    and any(
                        option.startswith("-") and "c" in option[1:]
                        for option in shell_options
                    )
                ):
                    return True
            continue
        index += 1
        while index < len(tokens) and tokens[index].startswith("-"):
            option = tokens[index]
            if option in options_with_values:
                if index + 1 >= len(tokens):
                    return True
                return True
            if option.startswith(
                (
                    "-C",
                    "-c",
                    "--config-env=",
                    "--exec-path=",
                    "--git-dir=",
                    "--namespace=",
                    "--super-prefix=",
                    "--work-tree=",
                )
            ):
                return True
            index += 1
        if index >= len(tokens):
            continue
        subcommand = tokens[index]
        arguments = tokens[index + 1 :]
        if subcommand in {
            "am",
            "checkout",
            "cherry-pick",
            "switch",
            "clean",
            "merge",
            "rebase",
            "reset",
            "restore",
            "revert",
            "symbolic-ref",
            "update-ref",
        }:
            return True
        if subcommand == "commit" and any(
            argument == "-n"
            or re.fullmatch(r"-[apqsvio]*n[apqsvio]*", argument) is not None
            or any(
                len(argument) >= 4 and option.startswith(argument)
                for option in ("--amend", "--no-verify")
            )
            for argument in arguments
        ):
            return True
        if subcommand == "push":
            branch = current_branch(repo_root)
            if (
                len(arguments) > 2
                or any(argument.startswith(("-", "+")) or ":" in argument for argument in arguments)
                or (
                    len(arguments) == 2
                    and arguments[1] not in {branch, f"refs/heads/{branch}", "HEAD"}
                )
            ):
                return True
        if subcommand == "branch" and arguments and any(
            not argument.startswith("-")
            or argument
            in {
                "-c",
                "-C",
                "-d",
                "-D",
                "-m",
                "-M",
                "-u",
                "--copy",
                "--delete",
                "--edit-description",
                "--move",
                "--set-upstream-to",
                "--unset-upstream",
            }
            or argument.startswith(
                ("-c", "-C", "-d", "-D", "-m", "-M", "-u", "--set-upstream-to=")
            )
            for argument in arguments
        ):
            return True
        if subcommand == "worktree" and any(
            argument in {"add", "lock", "move", "prune", "remove", "repair", "unlock"}
            for argument in arguments
        ):
            return True
        try:
            alias = subprocess.run(
                ["git", "config", "--get", f"alias.{subcommand}"],
                cwd=repo_root,
                env=_clean_git_env(),
                check=False,
                capture_output=True,
                text=True,
            )
        except OSError:
            return True
        if alias.returncode not in {0, 1} or (alias.returncode == 0 and alias.stdout.strip()):
            return True
    return False


def ensure_non_agent_shell_command_allowed(
    repo_root: Path,
    command: str,
    session_id: str = "unknown",
    command_cwd: str = "",
) -> str | None:
    if not command:
        return None
    if (
        os.environ.get(PROTECTED_BRANCH_EDIT_OVERRIDE_ENV) == "1"
        or os.environ.get(SHELL_GUARD_OVERRIDE_ENV) == "1"
    ):
        return None

    branch = current_branch(repo_root)
    protected = resolve_protected_branches(repo_root)
    if is_agent_branch(branch, protected):
        return None
    adaptive_mode = branch in protected and guardex_worktree_mode(repo_root) == "adaptive"
    if adaptive_mode and is_unsafe_primary_git_command(repo_root, command):
        return (
            f"BLOCKED: Branch/worktree mutation is unsafe on protected branch '{branch}'.\n"
            "Use `gx branch start --new --no-transfer` instead."
        )
    if is_allowed_non_agent_shell_command(command):
        if adaptive_mode:
            adaptive_error = adaptive_direct_work_error(repo_root, session_id)
            if adaptive_error:
                return adaptive_error
        return None

    if adaptive_mode:
        if not is_allowed_adaptive_direct_shell_command(command):
            return (
                f"BLOCKED: Shell command is outside the bounded adaptive allowlist on protected branch '{branch}'.\n"
                "Use an isolated lane for custom executors or scripts:\n"
                '  gx branch start --new --no-transfer "<task>" "<agent-name>"'
            )
        git_lock_error = adaptive_git_lock_error(repo_root, command, session_id, command_cwd)
        if git_lock_error:
            return git_lock_error
        adaptive_error = adaptive_direct_work_error(repo_root, session_id)
        if adaptive_error == "":
            return None
        if adaptive_error:
            return adaptive_error

    if branch in protected:
        blocked_scope = f"protected branch '{branch}'"
    else:
        blocked_scope = f"non-agent branch '{branch or 'HEAD'}'"

    preview = command.strip().splitlines()[0][:180]
    return (
        f"BLOCKED: Shell command may mutate files on {blocked_scope}.\n"
        "Open an isolated agent worktree (single command, dirty tree migrates with you):\n"
        '  gx branch start "<task>" "<agent-name>"\n'
        "Then `cd` into the printed WORKTREE_PATH and retry from there.\n"
        "Equivalent legacy form:\n"
        '  bash scripts/agent-branch-start.sh "<task>" "<agent-name>"\n'
        f"Command preview: {preview}\n"
        "Override (must be exported in the harness env, not as a command prefix):\n"
        f"  export {SHELL_GUARD_OVERRIDE_ENV}=1"
    )


def ensure_main_rs_lock(file_path: str, session_id: str) -> str | None:
    """Return an error message when main.rs lock is missing/owned by another session."""
    if not normalize_path(file_path).endswith(MAIN_RS_REL_PATH):
        return None

    repo_root = find_repo_root(file_path)
    branch = current_branch(repo_root)
    if branch in resolve_protected_branches(repo_root) and os.environ.get("ALLOW_MAIN_RS_EDIT_ON_PROTECTED_BRANCH") != "1":
        return (
            f"BLOCKED: main.rs edits are not allowed on protected branch '{branch}'.\n"
            "Use agent branch/worktree first:\n"
            '  bash scripts/agent-branch-start.sh "<task>" "<agent-name>"'
        )

    required_agent = DEFAULT_MAIN_RS_INTEGRATOR_AGENT
    if os.environ.get("ALLOW_MAIN_RS_NON_INTEGRATOR_BRANCH") != "1":
        if branch_agent_name(branch) != required_agent:
            return (
                f"BLOCKED: main.rs can only be edited from integrator branch agent/{required_agent}/...\n"
                f"Current branch: '{branch}'."
            )

    lock_path = repo_root / MAIN_RS_LOCK_REL_PATH
    if not lock_path.exists():
        return (
            "BLOCKED: rust/codex-lb-runtime/src/main.rs requires an ownership lock.\n"
            "Run: python3 scripts/main_rs_lock.py claim --owner \"<agent-name>\" "
            f'--branch "{branch or "<agent-branch>"}"'
        )

    try:
        lock_data = json.loads(lock_path.read_text())
    except (json.JSONDecodeError, OSError):
        return (
            "BLOCKED: rust main.rs lock file is unreadable.\n"
            "Run: python3 scripts/main_rs_lock.py claim --owner \"<agent-name>\" --force"
        )

    expires_at_epoch = lock_data.get("expires_at_epoch")
    if isinstance(expires_at_epoch, (int, float)) and time.time() > float(expires_at_epoch):
        return (
            "BLOCKED: rust main.rs lock is expired.\n"
            "Run: python3 scripts/main_rs_lock.py claim --owner \"<agent-name>\""
        )

    owner_branch = lock_data.get("owner_branch")
    if owner_branch and branch and owner_branch != branch:
        owner_label = lock_data.get("owner") or owner_branch
        return (
            f"BLOCKED: rust main.rs lock is owned by branch '{owner_branch}' ({owner_label}).\n"
            f"Current branch: '{branch}'.\n"
            "Status: python3 scripts/main_rs_lock.py status"
        )

    integrator_agent = lock_data.get("integrator_agent") or required_agent
    if branch_agent_name(branch) != integrator_agent:
        return (
            f"BLOCKED: main.rs lock requires integrator branch agent/{integrator_agent}/...\n"
            f"Current branch: '{branch}'."
        )

    if not owner_branch:
        return (
            "BLOCKED: rust main.rs lock is legacy/missing owner_branch.\n"
            "Re-claim with branch ownership:\n"
            "  python3 scripts/main_rs_lock.py claim --owner \"<agent-name>\" "
            f'--branch "{branch or "<agent-branch>"}" --force'
        )

    owner_session_id = lock_data.get("owner_session_id")
    if not owner_session_id:
        return None
    if owner_session_id == session_id:
        return None

    owner_label = lock_data.get("owner") or owner_branch or "unknown owner"
    return (
        f"BLOCKED: rust main.rs lock is currently owned by {owner_label} on branch '{owner_branch}'.\n"
        "Use a different file/module or wait for release.\n"
        "Status: python3 scripts/main_rs_lock.py status"
    )


def main() -> None:
    if len(sys.argv) == 6 and sys.argv[1] == "--adaptive-command-lock":
        run_with_adaptive_command_lock(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])

    try:
        input_data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)  # fail-open

    session_id = input_data.get("session_id", "unknown")
    tool_input = input_data.get("tool_input", {})
    file_path = tool_input.get("file_path", "")
    cwd = input_data.get("cwd", "")
    repo_root = resolve_repo_root(file_path, cwd)
    if not guardex_repo_is_enabled(repo_root):
        sys.exit(0)

    shell_command = extract_shell_command(tool_input)
    shell_command_error = ensure_non_agent_shell_command_allowed(
        repo_root,
        shell_command,
        session_id,
        cwd,
    )
    if shell_command_error:
        emit_event(
            session_id,
            "hook.invoked",
            {
                "hook": "skill_guard",
                "trigger": "PreToolUse",
                "outcome": "shell_command_blocked",
                "matched_count": 1,
                "exit_code": 2,
            },
        )
        print(shell_command_error, file=sys.stderr)
        sys.exit(2)

    updated_tool_input = adaptive_command_lock_tool_input(repo_root, tool_input, session_id)
    if updated_tool_input is not None:
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "updatedInput": updated_tool_input,
                    }
                }
            )
        )

    target_paths: list[str] = []
    if isinstance(file_path, str) and file_path.strip():
        target_paths.append(file_path.strip())

    patch_payload = ""
    for key in ("patch", "content", "input", "text"):
        value = tool_input.get(key)
        if isinstance(value, str) and "*** Begin Patch" in value and "*** End Patch" in value:
            patch_payload = value
            break

    if patch_payload:
        for match in PATCH_FILE_HEADER_RE.finditer(patch_payload):
            patch_path = match.group(1).strip()
            if patch_path and patch_path not in target_paths:
                target_paths.append(patch_path)

    if not target_paths:
        sys.exit(0)

    # Only files inside the guarded repo's working tree are subject to the edit
    # guard. Writes to paths outside the repo (memory files under ~/.claude,
    # /tmp scratch, etc.) never touch the protected checkout, so allow them
    # regardless of the current repo's branch.
    in_repo_targets = [p for p in target_paths if path_within_repo(p, repo_root, cwd)]
    if not in_repo_targets:
        sys.exit(0)

    # Judge each in-repo target by the branch of ITS OWN worktree, not the
    # session cwd's. A file nested in a linked agent worktree (e.g. under
    # .omc/agent-worktrees/) is physically inside the protected checkout but is
    # checked out on an agent branch, so editing it can never touch the protected
    # branch and must be allowed even while the session sits on a protected base.
    # Block on the first target that actually resolves to a protected branch.
    session_common_dir = git_common_dir(repo_root)
    for target_path in in_repo_targets:
        abs_target = resolve_target_path(target_path, repo_root, cwd)
        target_root = find_repo_root(str(abs_target))
        # Judge by the target's OWN branch only when it lives in a linked
        # worktree of the SAME repo (shared git common dir). For the session
        # repo itself, or a nested independent repo / submodule, fall back to the
        # session branch (prior behavior): over-blocking a foreign nested repo is
        # worse than the worktree carve-out is good, and only the worktree case
        # is the bug we are fixing.
        if (
            target_root != repo_root
            and session_common_dir
            and git_common_dir(target_root) == session_common_dir
        ):
            judge_path = str(abs_target)
        else:
            judge_path = str(repo_root)
        protected_branch_error = ensure_protected_branch_edit_allowed(
            judge_path,
            session_id,
            str(abs_target),
        )
        if protected_branch_error:
            emit_event(
                session_id,
                "hook.invoked",
                {
                    "hook": "skill_guard",
                    "trigger": "PreToolUse",
                    "outcome": "protected_branch_blocked",
                    "matched_count": 1,
                    "exit_code": 2,
                },
            )
            print(protected_branch_error, file=sys.stderr)
            sys.exit(2)

    for target_path in in_repo_targets:
        lock_error = ensure_main_rs_lock(target_path, session_id)
        if lock_error:
            emit_event(
                session_id,
                "hook.invoked",
                {
                    "hook": "skill_guard",
                    "trigger": "PreToolUse",
                    "outcome": "main_rs_locked",
                    "matched_count": 1,
                    "exit_code": 2,
                },
            )
            print(lock_error, file=sys.stderr)
            sys.exit(2)

    try:
        rules = load_skill_rules()
    except (FileNotFoundError, json.JSONDecodeError):
        sys.exit(0)  # fail-open

    skills = rules.get("skills", {})

    session_state = load_session_state(session_id)

    # --- Phase 1: Hard block guardrails ---
    guardrails = {
        name: rule
        for name, rule in skills.items()
        if rule.get("type") == "guardrail" and rule.get("enforcement") == "block"
    }

    for name, rule in guardrails.items():
        file_triggers = rule.get("fileTriggers")
        if not file_triggers:
            continue

        path_patterns = file_triggers.get("pathPatterns", [])
        matched_target = ""
        for target_path in in_repo_targets:
            if not match_path_patterns(target_path, path_patterns):
                continue
            path_exclusions = file_triggers.get("pathExclusions", [])
            if path_exclusions and match_path_patterns(target_path, path_exclusions):
                continue
            content_patterns = file_triggers.get("contentPatterns", [])
            if content_patterns and not match_content_patterns(target_path, content_patterns):
                continue
            matched_target = target_path
            break

        if not matched_target:
            continue

        # --- Skip conditions ---
        skip = rule.get("skipConditions", {})

        pass_state_file = skip.get("passStateFile")
        if pass_state_file and check_pass_state(pass_state_file):
            continue

        if skip.get("sessionSkillUsed") and name in session_state.get("usedSkills", []):
            continue

        file_markers = skip.get("fileMarkers", [])
        if file_markers and check_file_markers(matched_target, file_markers):
            continue

        env_override = skip.get("envOverride")
        if env_override and os.environ.get(env_override):
            continue

        # All checks passed — block
        emit_event(
            session_id,
            "hook.invoked",
            {
                "hook": "skill_guard",
                "trigger": "PreToolUse",
                "outcome": "blocked",
                "matched_count": 1,
                "exit_code": 2,
            },
        )
        block_message = rule.get(
            "blockMessage",
            f"BLOCKED: Skill '{name}' must be invoked before editing this file.\nUse Skill tool: '{name}'",
        )
        print(block_message, file=sys.stderr)
        sys.exit(2)

    # --- Phase 2: Remind enforcement (warn-only) ---
    remind_rules = {
        name: rule for name, rule in skills.items() if rule.get("enforcement") == "remind" and rule.get("fileTriggers")
    }

    for name, rule in remind_rules.items():
        file_triggers = rule.get("fileTriggers", {})

        path_patterns = file_triggers.get("pathPatterns", [])
        matched_target = ""
        for target_path in in_repo_targets:
            if not match_path_patterns(target_path, path_patterns):
                continue
            path_exclusions = file_triggers.get("pathExclusions", [])
            if path_exclusions and match_path_patterns(target_path, path_exclusions):
                continue
            content_patterns = file_triggers.get("contentPatterns", [])
            if content_patterns and not match_content_patterns(target_path, content_patterns):
                continue
            matched_target = target_path
            break

        if not matched_target:
            continue

        # --- Skip conditions ---
        skip = rule.get("skipConditions", {})

        if skip.get("sessionSkillUsed") and name in session_state.get("usedSkills", []):
            continue

        env_override = skip.get("envOverride")
        if env_override and os.environ.get(env_override):
            continue

        # Emit reminder but allow write to proceed.
        emit_event(
            session_id,
            "hook.invoked",
            {
                "hook": "skill_guard",
                "trigger": "PreToolUse",
                "outcome": "remind_notice",
                "matched_count": 1,
                "exit_code": 0,
            },
        )
        reminder_message = rule.get(
            "blockMessage",
            f"BLOCKED: Run /{name} first.\n"
            f"You must invoke this skill before editing this file.\n\n"
            f"→ Skill tool: '{name}'",
        )
        if reminder_message.startswith("BLOCKED:"):
            reminder_message = reminder_message.replace("BLOCKED:", "REMINDER:", 1)
        print(reminder_message, file=sys.stderr)

    emit_event(
        session_id,
        "hook.invoked",
        {
            "hook": "skill_guard",
            "trigger": "PreToolUse",
            "outcome": "passed",
            "matched_count": 0,
            "exit_code": 0,
        },
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
