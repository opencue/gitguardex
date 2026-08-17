# agent-claude-assert-codex-hooks-are-symlinks-in-ci-2026-08-17-10-07 (minimal / T1)

Branch: `agent/claude/assert-codex-hooks-are-symlinks-in-ci-2026-08-17-10-07`

Extends `scripts/check-script-symlinks.sh` to assert the second mirrored tree:
every tracked `.codex/hooks/*.py` must be a relative symlink to
`../../.claude/hooks/<same-name>`, non-dangling.

Follow-up to the review of #703, which landed
`.codex/hooks/{agent_branch_advisor,_session_presence}.py` as real file copies
while the other four entries were symlinks. `HOOKS.md` declares symlinks the
contract and names a SHA1 CI assertion as the only alternative; neither was in
place, so nothing caught it.

## Design note

The hook list is derived from `git ls-files -- '.codex/hooks/*.py'`, not a
hand-maintained array like `required_symlinks`. A fixed list would not have
caught #703: whoever adds a hook as a copy is exactly the person who would not
think to add it to the list. Glob-derived means a hook added tomorrow is covered
the moment it lands.

Failure hints are printed per-tree so a hooks-only failure does not lead with a
`scripts/` fix command that repairs nothing.

No workflow edit needed: `.github/workflows/ci.yml:61` and `ci-full.yml:57`
already run this script.

## Verification

| Case | Result |
|---|---|
| `bash -n` syntax | OK |
| Clean tree | `OK: 14 paired script(s), 6 hook symlink(s) verified.` exit 0 |
| Hook as real copy (the #703 defect) | `not a symlink: .codex/hooks/...` exit 1 |
| Hook wrong symlink target | `wrong symlink target: ... (expected ...)` exit 1 |
| Hook dangling target | caught, exit 1 |
| Hooks-only failure | prints only the `.codex/hooks/` hint |
| Scripts-only failure | prints only the `scripts/` hint |

Tree restored after each negative case; `git status` shows only
`scripts/check-script-symlinks.sh` modified.

## Handoff

- Handoff: change=`agent-claude-assert-codex-hooks-are-symlinks-in-ci-2026-08-17-10-07`; branch=`agent/claude/assert-codex-hooks-are-symlinks-in-ci-2026-08-17-10-07`; scope=`scripts/check-script-symlinks.sh`; action=`finish via PR into main`.

## Cleanup

- [ ] Run: `gx branch finish --branch agent/claude/assert-codex-hooks-are-symlinks-in-ci-2026-08-17-10-07 --base main --via-pr --wait-for-merge --cleanup`
- [ ] Record PR URL + `MERGED` state in the completion handoff.
- [ ] Confirm sandbox worktree is gone (`git worktree list`, `git branch -a`).
