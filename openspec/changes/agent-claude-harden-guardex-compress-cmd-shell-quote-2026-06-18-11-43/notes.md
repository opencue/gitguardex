# agent-claude-harden-guardex-compress-cmd-shell-quote-2026-06-18-11-43 (minimal / T1)

Branch: `agent/claude/harden-guardex-compress-cmd-shell-quote-2026-06-18-11-43`

Replace the naive whitespace split in `resolveCompressCommand` (GUARDEX_COMPRESS_CMD,
src/output/index.js) with a shell-quote-aware `tokenizeCommand` so values like
`sh -c "tr a-z A-Z"` parse correctly; malformed input (unterminated quote / dangling
backslash) returns null so the caller falls back to plain output. Follow-up to PR #649.

## Handoff

- Handoff: change=`agent-claude-harden-guardex-compress-cmd-shell-quote-2026-06-18-11-43`; branch=`agent/<your-name>/<branch-slug>`; scope=`TODO`; action=`continue this sandbox or finish cleanup after a usage-limit/manual takeover`.
- Copy prompt: Continue `agent-claude-harden-guardex-compress-cmd-shell-quote-2026-06-18-11-43` on branch `agent/<your-name>/<branch-slug>`. Work inside the existing sandbox, review `openspec/changes/agent-claude-harden-guardex-compress-cmd-shell-quote-2026-06-18-11-43/notes.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
