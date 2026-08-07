# agent-claude-batch-pre-commit-lock-auto-claim-into-on-2026-08-07-12-46 (minimal / T1)

Branch: `agent/claude/batch-pre-commit-lock-auto-claim-into-on-2026-08-07-12-46`

`templates/githooks/pre-commit` auto-claimed staged paths one process per file.
Every `gx locks claim` spawns node -> python and `load_all_locks()` rescans every
worktree's lock file, so the loop cost ~150ms per staged path on every commit —
pure wall-clock an agent spends "waiting for the locks". Claim once with the
whole staged set instead (the staged-deletes branch right below already did).

`locks claim` is atomic: one foreign-owned path rejects the whole batch and
claims nothing. So on batch failure the hook falls back to the old per-file
loop, keeping `locks validate --staged` naming only the genuinely conflicting
path rather than reporting every staged file as unclaimed.

## Verification

- End-to-end hook, 30 staged files, 12 worktrees: **15012ms -> 1327ms** (11x).
- Isolated claim cost, 24 files: 3654ms per-file vs 160ms batched (23x).
- Conflict path: 3 staged files, 1 pre-claimed by `agent/other/lane` ->
  hook blocks and reports only that path; the other two are claimed by the
  fallback. Matches pre-change behavior exactly.
- `npm test`: 41 failing on this branch, 41 on `main`, failing sets
  byte-identical (`comm` diff empty both directions) — no new failures.
- `bash scripts/check-script-symlinks.sh` OK; `node --check bin/multiagent-safety.js` OK.
- `npm run lint` cannot run locally (`biome: not found`); change is bash-only,
  outside biome's `bin src scripts test` scope.

## Handoff

- Handoff: change=`agent-claude-batch-pre-commit-lock-auto-claim-into-on-2026-08-07-12-46`; branch=`agent/claude/batch-pre-commit-lock-auto-claim-into-on-2026-08-07-12-46`; scope=`templates/githooks/pre-commit staged-lock auto-claim batching`; action=`finish via PR`.
- Copy prompt: Continue `agent-claude-batch-pre-commit-lock-auto-claim-into-on-2026-08-07-12-46` on branch `agent/claude/batch-pre-commit-lock-auto-claim-into-on-2026-08-07-12-46`. Work inside the existing sandbox, review `openspec/changes/agent-claude-batch-pre-commit-lock-auto-claim-into-on-2026-08-07-12-46/notes.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/claude/batch-pre-commit-lock-auto-claim-into-on-2026-08-07-12-46 --base main --via-pr --wait-for-merge --cleanup`.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/batch-pre-commit-lock-auto-claim-into-on-2026-08-07-12-46 --base main --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
