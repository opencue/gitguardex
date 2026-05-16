## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks, add a `BLOCKED:` line under section 4 and stop.

## 1. Specification

- [x] 1.1 Capture the `gx setup --current` alias scope and acceptance criteria.
- [x] 1.2 Add normative OpenSpec coverage for the single-repo setup alias behavior.

## 2. Implementation

- [x] 2.1 Accept `--current` as a setup alias for the existing single-repo traversal path.
- [x] 2.2 Update recursive setup messaging to mention `--current`.
- [x] 2.3 Add a regression proving nested repos under the target path stay untouched.

## 3. Verification

- [x] 3.1 Run `node --check bin/multiagent-safety.js`.
- [x] 3.2 Run `node --test test/setup.test.js`.
- [x] 3.3 Run `node --test test/metadata.test.js`.
- [x] 3.4 Run `openspec validate setup-current-single-repo-alias --type change --strict`.
- [x] 3.5 Run `openspec validate --specs`.

Verification note: `node --test test/doctor.test.js` also passed, keeping `gx doctor --current` green after moving repo-traversal parsing into `src/cli/args.js`. Direct dry-run CLI smoke proved both `doctor --current` and `setup --current` now parse, then continued into normal repo-drift/conflict handling instead of failing with `Unknown option: --current`.

## 4. Cleanup

- [x] 4.1 Commit the change with a Lore commit message.
- [x] 4.2 Run `gx branch finish --branch agent/codex/split-cli-main-args-dispatch-2026-04-22-13-48 --base main --via-pr --wait-for-merge --cleanup`.
- [x] 4.3 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.4 Confirm the sandbox worktree and branch refs are gone after cleanup.

Implementation note: the `--current` alias now routes through shared repo-traversal parsing in `src/cli/args.js`, so `gx setup --current` and `gx doctor --current` both stay on the single-repo path without mutating nested repos.
