# Codex Approval Policy Guidance

## Problem

Agents can mistake Guardex finish automation for permission to bypass Codex host approval gates when pushing to external remotes.

## Change

- Clarify the managed AGENTS completion policy: Guardex cannot bypass Codex host approvals or external-remote policy decisions.
- Route blocked publish work through one narrow `gx branch finish ...` approval instead of repeated standalone `git push` / `gh pr` attempts.
- Add setup coverage so generated AGENTS blocks keep this wording.

## Verification

- `node --test test/setup.test.js` - pass, 43 tests
- `openspec validate --specs` - pass, no spec items to validate
