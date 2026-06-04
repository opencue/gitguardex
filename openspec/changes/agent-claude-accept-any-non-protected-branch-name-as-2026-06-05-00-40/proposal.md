## Why

Agents were forced onto the `agent/*` namespace (plus a fixed `claude/`/`codex/`/`cursor/`
allowlist) to edit or commit. Any other branch name — `vendor/x`, `feat/y`, or
an ad-hoc lane — was blocked, even though it is not a protected base. Two
independent layers enforced this with different, stricter rules, so an agent
on `vendor/...` hit a wall first at file-edit time (skill_guard.py) and again at
commit time (the git pre-commit hook), with no single mental model.

The load-bearing safety rule is only "do not touch a protected base". The branch
*name* off that base should not matter.

## What Changes

- **skill_guard.py (Claude Code PreToolUse guard)**: `is_agent_branch()` now
  treats ANY non-protected branch as agent-managed by default, honoring the
  repo-resolved protected set. The prefix allowlist now applies only under
  `GUARDEX_AGENT_BRANCH_PREFIXES_ONLY=1` (lockdown).
- **templates/githooks/pre-commit (git commit guard)**: non-protected branches
  are accepted for all agent sessions (Claude, Codex, OMX). Protected-branch
  blocking and the Codex managed-only (`AGENTS.md`/`.gitignore`) exception are
  unchanged. A new `GUARDEX_REQUIRE_AGENT_BRANCH=1` /
  `multiagent.requireAgentBranch` lockdown re-imposes the `agent/*` requirement.
- **Docs**: AGENTS.md / CLAUDE.md quickstart updated so agents know up front that
  any non-protected branch is fine.

## Impact

- **Affected surfaces**: `.claude/hooks/skill_guard.py`,
  `templates/githooks/pre-commit`, `AGENTS.md`. Propagates to consumer repos via
  `gx claude install` / hook templates.
- **Behavior change**: the default Codex `codexRequireAgentBranch` gate no longer
  blocks non-protected branches; lockdown is now opt-in via
  `GUARDEX_REQUIRE_AGENT_BRANCH`. Explicitly-configured strictness is preserved.
- **Safety unchanged**: protected bases (`main`/`dev`/`master` + configured) stay
  blocked for agents; the Codex managed-only-on-protected exception is preserved.
- **Rollout**: no version bump. Verified by `test/skill-guard-hook.test.js`,
  `test/branch.test.js`, `test/setup.test.js`; failing-test set is byte-identical
  to base (no new failures).
