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
# Extra agent-branch prefixes (comma- or space-separated). The hardcoded
# "agent/" prefix is always recognized; this env var adds session-managed
# prefixes like "claude/" without forcing repos to fork the hook.
AGENT_BRANCH_PREFIXES_ENV = "GUARDEX_AGENT_BRANCH_PREFIXES"
DEFAULT_AGENT_BRANCH_PREFIXES = ("agent/",)
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
    # Pushing agent/* branches from any cwd is safe — guarded branch namespace.
    re.compile(r"^git\s+push(?:\s+(?:-u|--set-upstream))?\s+\S+\s+agent/[^\s]+(?:\s|$)"),
    re.compile(r"^git\s+push(?:\s+(?:-u|--set-upstream))?\s+\S+\s+HEAD:agent/[^\s]+(?:\s|$)"),
    re.compile(
        r"^gh\s+(?:auth\s+status|repo\s+view|pr\s+(?:list|view|checks|status|create|edit|comment|review|ready|reopen|merge)|issue\s+(?:list|view|status|create|comment)|run\s+(?:list|view|watch)|workflow\s+(?:list|view|run))\b"
    ),
    re.compile(r"^git\s+(?:checkout|switch)\s+agent/[^\s]+(?:\s|$)"),
    re.compile(r"^(?:ls|cat|head|tail|wc|nl|sed\s+-n|rg|find|stat|du|df|ps|ss|which|command\s+-v)\b"),
    # All gitguardex CLI subcommands are themselves safety-aware; trust them on protected branches.
    re.compile(r"^(?:gx|guardex|gitguardex|multiagent-safety)\s+\S+\b"),
    re.compile(r"^python3?\s+scripts/(?:agent-file-locks\.py|main_rs_lock\.py)\s+(?:status|list|validate)\b"),
    re.compile(
        r"^(?:bash\s+)?(?:(?:\.{1,2}/)?scripts|(?:/|~)[^\s]*/scripts)/(?:agent-branch-start\.sh|agent-branch-finish\.sh|agent-pivot\.sh|codex-agent\.sh|install-agent-git-hooks\.sh)\b"
    ),
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
    if file_path:
        return find_repo_root(file_path)
    if cwd:
        return find_repo_root(cwd)
    return Path.cwd()


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


def agent_branch_prefixes() -> tuple[str, ...]:
    """Active agent-branch prefixes: defaults plus GUARDEX_AGENT_BRANCH_PREFIXES."""
    extras = _parse_branch_prefixes(os.environ.get(AGENT_BRANCH_PREFIXES_ENV, ""))
    seen: set[str] = set()
    out: list[str] = []
    for prefix in (*DEFAULT_AGENT_BRANCH_PREFIXES, *extras):
        if prefix not in seen:
            seen.add(prefix)
            out.append(prefix)
    return tuple(out)


def is_agent_branch(branch: str) -> bool:
    """Treat branch as agent-managed if it matches any active prefix."""
    if not branch:
        return False
    return any(branch.startswith(prefix) for prefix in agent_branch_prefixes())


def is_codex_session() -> bool:
    """Best-effort detection for Codex/OMX automated sessions."""
    return bool(
        os.environ.get("CODEX_THREAD_ID")
        or os.environ.get("OMX_SESSION_ID")
        or os.environ.get("CODEX_CI") == "1"
    )


def ensure_protected_branch_edit_allowed(file_path: str) -> str | None:
    """Block Codex edits on non-agent branches and all edits on protected branches."""
    if os.environ.get(PROTECTED_BRANCH_EDIT_OVERRIDE_ENV) == "1":
        return None
    repo_root = find_repo_root(file_path)
    branch = current_branch(repo_root)
    if is_agent_branch(branch):
        return None

    if branch in PROTECTED_BRANCHES:
        blocked_scope = f"protected branch '{branch}'"
    elif is_codex_session():
        blocked_scope = f"non-agent branch '{branch or 'HEAD'}'"
    else:
        return None

    return (
        f"BLOCKED: Agent edit attempted on {blocked_scope}.\n"
        "Auto-pivot to an isolated agent worktree (single command, dirty tree migrates with you):\n"
        '  gx pivot "<task>" "<agent-name>"\n'
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


def ensure_non_agent_shell_command_allowed(repo_root: Path, command: str) -> str | None:
    if not command:
        return None
    if (
        os.environ.get(PROTECTED_BRANCH_EDIT_OVERRIDE_ENV) == "1"
        or os.environ.get(SHELL_GUARD_OVERRIDE_ENV) == "1"
    ):
        return None

    branch = current_branch(repo_root)
    if is_agent_branch(branch):
        return None
    if is_allowed_non_agent_shell_command(command):
        return None

    if branch in resolve_protected_branches(repo_root):
        blocked_scope = f"protected branch '{branch}'"
    else:
        blocked_scope = f"non-agent branch '{branch or 'HEAD'}'"

    preview = command.strip().splitlines()[0][:180]
    return (
        f"BLOCKED: Shell command may mutate files on {blocked_scope}.\n"
        "Auto-pivot to an isolated agent worktree (single command, dirty tree migrates with you):\n"
        '  gx pivot "<task>" "<agent-name>"\n'
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
    shell_command_error = ensure_non_agent_shell_command_allowed(repo_root, shell_command)
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

    protected_branch_error = ensure_protected_branch_edit_allowed(repo_root)
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

    for target_path in target_paths:
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
        for target_path in target_paths:
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
        for target_path in target_paths:
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
