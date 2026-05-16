# Tasks

## 1. Spec
- [x] 1.1 Capture proposal in `proposal.md` (root cause + 5 invariants).
- [x] 1.2 Capture spec delta in `specs/gitguardex-submodules/spec.md`
       (4 ADDED requirements with BDD scenarios).
- [ ] 1.3 Run `openspec validate --specs` and attach output to the
       finish handoff.

## 2. Tests
- [ ] 2.1 Add `test/agent-submodules-detect.test.js` covering
       `parseGitmodules`, `classifySubmodule` (clean / dirty /
       uninitialized / missing-remote), and `manifestForFinish`.
- [ ] 2.2 Add `test/agent-submodules-locks.test.py` covering
       `(submodule_root, path)` keying — same relative path inside
       parent and submodule must NOT collide.
- [ ] 2.3 Add `test/agent-submodules-finish.test.js` covering the
       atomic gitlink bump (one parent commit only after all child
       PRs hit `MERGED`; partial-failure leaves parent untouched).
- [ ] 2.4 Add `test/agent-submodules-preflight.test.js` covering the
       cross-org token probe (mocks `api.github.com/repos/...`
       returning 404/401/403/200 → expected failure modes).

## 3. Implementation
- [ ] 3.1 Add `scripts/agent-submodules.py` with `parse_gitmodules`,
       `submodule_status`, `classify`, `manifest_for_branch`,
       `preflight_token`, `init_in_worktree`.
- [ ] 3.2 Extend `scripts/agent-branch-start.sh`: after worktree
       creation, run `init_in_worktree` (skipped under
       `GUARDEX_SUBMODULE_INIT=0`); record manifest in
       `.omc/agent-worktrees/<slug>/.guardex/submodules.json`.
- [ ] 3.3 Extend `scripts/agent-file-locks.py`: replace bare-path
       keying with `(submodule_root, relative_path)`; back-compat
       read of legacy lock entries.
- [ ] 3.4 Extend `scripts/agent-branch-finish.sh`: read manifest,
       loop submodules in `GUARDEX_SUBMODULE_MODE`, share one
       merge-wait poller, stage atomic gitlink bump only after all
       child PRs hit `MERGED`.
- [ ] 3.5 Add `gx submodules status` and `gx submodules preflight`
       subcommands.
- [ ] 3.6 Update `AGENTS.md` Multi-Agent Execution Contract with a
       "Submodules" subsection; update README "How it works".

## 4. Verification
- [x] 4.1 `openspec validate --specs` → green.
- [x] 4.2 `npm test` → green (or recorded skip with reason).
- [x] 4.3 Live walkthrough on this repo: clean state → edit a file
       in `examples/hive` → `gx branch finish --via-pr`
       --wait-for-merge` → confirm child PR opens in `NagyVikt/hive`,
       merges, and parent commit lists exactly the bumped gitlinks.

## 5. Cleanup
- [x] 5.1 Commit changes on the agent branch.
- [x] 5.2 Push branch and open a PR.
- [x] 5.3 Run `gx branch finish ... --base main --via-pr
       --wait-for-merge --cleanup`.
- [x] 5.4 Record PR URL and `MERGED` evidence in handoff note.
