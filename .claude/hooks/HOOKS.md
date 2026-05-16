# Hooks (Claude + Codex)

`.claude/hooks/` is the canonical source for the Python hook scripts:

- `post_edit_tracker.py`
- `skill_activation.py`
- `skill_guard.py`
- `skill_tracker.py`

`.codex/hooks/` contains relative symlinks back to the canonical files so
both harnesses execute the same code. Edit only the files under
`.claude/hooks/`; never edit through the `.codex/hooks/` path.

If a future repo target (e.g. Windows) cannot follow symlinks, replace the
symlinks with real copies and add a CI step that asserts their SHA1 matches
the canonical files.

## Configuration

`skill_guard.py` enforces the multi-agent contract on PreToolUse events.

### Env vars

| Var | Purpose |
| --- | --- |
| `ALLOW_BASH_ON_NON_AGENT_BRANCH=1` | Bypass the shell-command guard. |
| `ALLOW_CODE_EDIT_ON_PROTECTED_BRANCH=1` | Bypass the protected-branch edit guard. |
| `ALLOW_CODE_EDIT_ON_PRIMARY_WORKTREE=1` | Allow agent edits in the primary worktree. |
| `GUARDEX_AGENT_BRANCH_PREFIXES` | Extra branch prefixes (comma- or space-separated) that count as agent-managed. `agent/` is always recognized. Example: `GUARDEX_AGENT_BRANCH_PREFIXES="claude/,codex/"`. |
| `GUARDEX_ON` | Repo toggle. Falsy values disable every guard. |
| `GUARDEX_PROTECTED_BRANCHES` | Additional protected branch names (comma- or space-separated). |

### Read-only allowlist

Even on non-agent / protected branches, `skill_guard.py` lets through
read-only shell commands so simple inspection (`git status`, `ls`, `cat`,
`gh pr view`, etc.) does not require setting an override. The full pattern
list lives in `SHELL_ALLOWED_SEGMENTS` inside `skill_guard.py`.

Mutating commands (`rm`, `git checkout main`, `git reset --hard`,
`git push origin main`, redirections that overwrite files, etc.) remain
blocked. To loosen the deny-list, change `skill_guard.py` directly and add
a regression test under `test/skill-guard-hook.test.js`.
