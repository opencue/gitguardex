# Improve Guard startup output design

## Problem

Guardex startup and takeover hints were hard to scan: machine-readable status,
human next steps, and finish/cleanup guidance were mixed into long lines.

## Scope

- Keep existing parser-stable `[agent-branch-start] Created branch` and
  `[agent-branch-start] Worktree` lines.
- Replace the human next-step block with aligned branch/worktree/next fields.
- Replace the long Codex takeover sentence with a scannable resume block.
- Include `--cleanup` in finish guidance.

## Verification

- `bash -n scripts/agent-branch-start.sh scripts/codex-agent.sh templates/scripts/agent-branch-start.sh templates/scripts/codex-agent.sh`
- `node --test test/branch.test.js test/sandbox.test.js test/metadata.test.js`
