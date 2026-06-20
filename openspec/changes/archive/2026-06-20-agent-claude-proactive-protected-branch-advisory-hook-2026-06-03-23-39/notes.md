# agent-claude-proactive-protected-branch-advisory-hook-2026-06-03-23-39 (minimal / T1)

Branch: `agent/claude/proactive-protected-branch-advisory-hook-2026-06-03-23-39`

## What & why

Make the agent **auto-know** it is on a protected branch *before* it edits or
commits, instead of only learning *after* a guard blocks it.

Every existing gitguardex guard is reactive — `skill_guard.py` (PreToolUse) and
`templates/githooks/pre-commit` only fire once the agent *attempts* a blocked
action. So an agent on `main` stages → `git commit` → blocked → tries to branch →
blocked → recovers, bouncing wall to wall. There was no proactive signal of the
current branch state.

This adds one proactive advisory hook, `.claude/hooks/agent_branch_advisor.py`,
wired into **SessionStart** and **UserPromptSubmit**. On a protected branch it
injects (via `hookSpecificOutput.additionalContext`, exit 0) a notice naming the
branch and the sanctioned `gx branch start` command, so the agent's first move
is to open an isolated worktree.

## Scope

- New `.claude/hooks/agent_branch_advisor.py` (added to `MANAGED_HOOK_FILES` so
  `gx claude install` distributes it; imports branch/protection predicates from
  the sibling `skill_guard.py` so the advisory can never disagree with the guard).
- `src/cli/commands/claude.js`: register advisor in `MANAGED_HOOK_FILES`,
  `EXPECTED_HOOK_MATCHERS` (SessionStart + UserPromptSubmit), and
  `TEMPLATE_DEFAULT_SETTINGS` (added to both event groups).
- `test/claude-install.test.js`: 2 tests (managed-file membership + both-event wiring).

## Behaviour

- Silent on `agent/*` (and other recognized agent) branches — zero noise.
- Silent on non-agent, non-protected branches (e.g. `feature/*`).
- Advisory only on protected branches (`dev`/`main`/`master` +
  `GUARDEX_PROTECTED_BRANCHES` / `multiagent.protectedBranches`).
- Fail-open: any error, malformed stdin, or `GUARDEX_ON=0` → no output, exit 0.
  Always exit 0 (UserPromptSubmit exit 2 would *reject the prompt* — advise, never block).

## Verification

- `node --test test/claude-install.test.js` → 14/14 pass (incl. 2 new).
- `node -c src/cli/commands/claude.js` → OK.
- Advisor runtime: silent on agent branch; correct per-event advisory JSON on
  `main` (SessionStart + UserPromptSubmit); fail-open on malformed stdin; silent
  under `GUARDEX_ON=0`.
- Hook contract confirmed against Claude Code hooks docs: both events inject via
  `hookSpecificOutput.additionalContext` at exit 0; SessionStart fires on
  startup/resume/clear/compact.

## Note (out of scope)

`scripts/agent-stalled-report.sh` (the existing SessionStart hook) is referenced
by the settings template but is NOT in `MANAGED_HOOK_FILES`, so `gx claude
install` does not copy it to target repos (latent gap). The advisor deliberately
lives in `.claude/hooks/` + `MANAGED_HOOK_FILES` to avoid that gap. Fixing the
stalled-report distribution is a separate follow-up.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/proactive-protected-branch-advisory-hook-2026-06-03-23-39 --base main --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
