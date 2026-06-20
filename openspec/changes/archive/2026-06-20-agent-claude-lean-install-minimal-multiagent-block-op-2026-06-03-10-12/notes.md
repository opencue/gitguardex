# agent-claude-lean-install-minimal-multiagent-block-op-2026-06-03-10-12 (minimal / T1)

Branch: `agent/claude/lean-install-minimal-multiagent-block-op-2026-06-03-10-12`

Make gitguardex's install lean: default `gx setup`/`gx doctor`/`gx install` inject a
~10-line **minimal** multi-agent block into a target repo's `AGENTS.md`; the full
171-line contract becomes opt-in via `--contract` (alias `--full`).

## What / Why

Adding gitguardex dumped a 171-line contract into `AGENTS.md` — heavy and noisy
("don't want the contract"). Most repos want only the load-bearing rules (branch +
worktree, claim files, finish via PR) without the full Colony/OpenSpec/token
appendix. Full contract stays one flag away.

## How

- New `templates/AGENTS.multiagent-safety.min.md` — same
  `<!-- multiagent-safety:START/END -->` markers, ~8 non-blank lines.
- `ensureAgentsSnippet(repoRoot, dryRun, options)` picks template by
  `options.contract`; **never downgrades** — an existing managed block over
  `FULL_BLOCK_LINE_THRESHOLD` (40 non-blank lines) keeps refreshing from the full
  template even without the flag.
- `--contract`/`--full`/`--minimal`/`--no-contract` parsed in shared
  `parseCommonArgs`; forwarded through sandbox respawn + recursive-doctor argv.

## Verify

- `node --test test/setup.test.js test/doctor.test.js` — contract tests green. The
  7 remaining failures are pre-existing environment failures (gh/npm/worktree
  detection), identical on baseline, unaffected by this diff.
- New test: "setup --contract opts into the full contract; default stays minimal
  and is never downgraded".

## Out of scope (follow-ups)

- `gx claude install --global` writer.
- Real gx-native merge gate (`mergeStateStatus` / fail-closed review) — global
  `/autoship` already gates at the agent level.

## Handoff

- Handoff: change=`agent-claude-lean-install-minimal-multiagent-block-op-2026-06-03-10-12`; branch=`agent/claude/lean-install-minimal-multiagent-block-op-2026-06-03-10-12`; scope=`lean install minimal block + opt-in contract`; action=`commit, then finish via PR`.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/lean-install-minimal-multiagent-block-op-2026-06-03-10-12 --base main --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
