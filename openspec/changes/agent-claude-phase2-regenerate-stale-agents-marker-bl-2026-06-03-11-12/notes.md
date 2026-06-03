# phase2-regenerate-stale-agents-marker-bl (minimal / T1)

Branch: `agent/claude/phase2-regenerate-stale-agents-marker-bl-2026-06-03-11-12`

Phase 2 of the gitguardex improvement plan: token efficiency, docs only. No code change.

## Scope

- **C1** — regenerated this repo's stale `AGENTS.md` managed marker block (was the pre-#607
  433-line full contract) from the now-trimmed `templates/AGENTS.multiagent-safety.md` (171 lines),
  via `scaffold.ensureAgentsSnippet`. `existingIsFull` keeps the full contract (no downgrade to
  minimal); content preserved, just denser. AGENTS.md 570 → 307 lines (marker 433 → 170),
  ~1,400 tokens reclaimed every session in the first always-loaded file. `CLAUDE.md` symlink benefits too.
- **C2** — `.agent/TOKEN-DISCIPLINE.md`: the token-budget bullets duplicated the marker and the framing
  falsely claimed "the canonical copy lives inside the markers." Replaced with a pointer to the marker's
  `### Token / context budget` subsection + the 5 operational heuristics unique to the subdoc. −14 lines.

## Not done

- **C3** (SPECKIT stub, `AGENTS.md:304-307`) — skipped: speckit-managed marker block, ~30 tokens, not worth fighting the tooling.

## Verification

- Regenerated marker block is byte-identical to `templates/AGENTS.multiagent-safety.md`; diff confined to
  the marker region (header + SPECKIT block untouched); markers balanced 1/1; `CLAUDE.md` still a symlink.
- `node --test test/*.test.js`: 551 pass / 24 fail / 1 skip — identical to the post-Phase-1 baseline.
  No test reads the repo-root `AGENTS.md` or `.agent/` docs (all use fixture repos in temp dirs), so a
  doc-only change cannot affect tests. `gx --help` and `gx prompt --snippet` exit 0.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/phase2-regenerate-stale-agents-marker-bl-2026-06-03-11-12 --base main --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
