# Native Worktrunk-inspired navigation and lifecycle hooks

## Outcome and boundaries

Keep GitGuardex as the sole worktree manager. Port useful behavior from Worktrunk
without installing or invoking `wt`, adding a Rust runtime, or adding dependencies.
Keep existing file claims, caller/ownership checks, hook consent, quotas, protected
branches, and PR/merge gates. OMX coordinates this implementation, not a new product
integration. Existing worktrees and unrelated changes must remain untouched.

## Evidence

- Worktrunk source: cached `max-sixty/worktrunk/main`; MIT OR Apache-2.0.
- GX already has safe isolated provisioning and ordered, approved `postCreate`.
- GX exposes `agents jump` but not general branch/PR worktree navigation.
- Branch creation and finish use native Git via package shell scripts.
- `.agent/PLANS.md` is referenced by AGENTS.md but absent in this checkout.

## Workstreams

1. Navigation: native branch/path/previous/PR resolution, interactive selection
   with diff/PR preview, machine-readable output and usable shell integration.
   Resolve existing worktrees first; new lanes go through GX branch-start safety.
   Never execute GitHub-provided strings as shell code or change the primary branch.
2. Lifecycle hooks: named pre/post start, switch, commit, merge, remove events;
   blocking pre hooks; detached logged post hooks; ordered stages with explicit
   parallel commands where supported. Local exact-command approval, timeouts,
   dry runs, failure reporting and compatible legacy postCreate behavior.
3. Copy gaps: explicit ignored-file copy selection, optional `.worktreeinclude`,
   dry run, and reuse of existing containment/no-overwrite/isolated copy machinery.
   Do not silently copy new files during ordinary branch creation.
4. Leader: route commands, connect actual lifecycle sites, integration tests,
   user documentation, attribution, and final shipping gates.

## Acceptance checks

- Navigation: real temporary repositories; branch/path/previous/PR resolution,
  malformed/untrusted selectors, non-TTY behavior, shell-safe paths, cancellation,
  safety-preserving creation, picker previews.
- Hooks: unapproved/changed commands do not run; blocking failure aborts operation;
  ordered prerequisites; post hooks return without waiting and leave logs/results;
  disabled/reduced provisioning stays disabled; legacy approvals still work.
- Copy: ignored-only selection, include/exclude rules, nested paths, no overwrite,
  no path/symlink escape, dry-run has no writes, no automatic policy broadening.
- Integration: actual CLI/start/finish/cleanup invokes events at the documented
  boundaries and never bypasses existing gate/ownership checks.
- Run focused tests, changed formatting, lint, full tests, package checks, and the
  repository's gated finish. Report any blocked gate rather than claiming done.

## Progress

- [x] Read current code, scope, licensing, and isolate the integration worktree.
- [x] Complete the three independent worker lanes.
- [x] Integrate actual CLI and lifecycle calls; document scope and attribution.
- [x] Verify focused tests, formatting, lint, packaging, and full coverage.
- [ ] Commit and finish via PR, wait for merge, clean up only this task's lanes.

## Verification results

- Full suite: 1444 tests, 1439 passed, 5 skipped, no failures.
- Coverage gate passed: lines 71.50%, branches 76.93%, functions 76.82%.
- Changed-file formatting, repository lint, and package checks passed.
- Added regression checks for detached cleanup, source changes in pre-merge,
  foreign-repository hook targets, and claims appearing while copying waits.
- Remote-shared-claim mode intentionally refuses explicit ignored copying;
  ordinary branch provisioning is unchanged. No performance savings claimed.

## Decisions and deviations

- No second worktree manager and no Ruflo dependency.
- New functionality remains opt-in; old commands/configuration keep their behavior.
- Reuse repository Node tests and existing CLI/UI patterns.
- Only the integration leader publishes/merges; workers return tested commits.
