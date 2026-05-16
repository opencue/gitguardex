## Why

- `.claude/hooks/` and `.codex/hooks/` shipped byte-identical copies of the same
  four Python hooks, inviting drift the next time someone edits one but not the
  other.
- `skill_guard.py` only recognized `agent/*` branches, which forced every
  session-managed branch (e.g. Claude Code's `claude/improve-codebase-*`
  lanes) to either disable the guard or rename the branch — neither is what we
  want.

## What Changes

- Promote `.claude/hooks/` to canonical and replace `.codex/hooks/*.py` with
  relative symlinks. Add `.claude/hooks/HOOKS.md` documenting the layout and
  config surface so future edits land in the right place.
- Introduce `GUARDEX_AGENT_BRANCH_PREFIXES` (comma/space-separated) so users
  can add prefixes like `claude/` or `codex/` without forking the hook.
- Extend the read-only shell allowlist with version probes
  (`node --version`, `python --version`, etc.) so they no longer require
  `ALLOW_BASH_ON_NON_AGENT_BRANCH=1`.
- Cover all of the above with `test/skill-guard-hook.test.js`.

## Impact

- Hooks under `.codex/hooks/` are now symlinks; any repo target that cannot
  follow symlinks needs to convert them to real copies and assert SHA1 parity
  in CI (documented in `HOOKS.md`).
- No deny-list weakening: mutating commands (`rm`, `git checkout main`,
  `git reset --hard`, redirections, etc.) remain blocked on protected/non-agent
  branches.
- New env var is opt-in; default behavior on existing repos is unchanged.
