# GitGuardex package layout

## Goal

Adopt AgenticBrowser's package-level separation without changing the installed
CLI, npm package identity, or frontend deployment target. Keep repository
tooling, integration tests, and CI at the root.

## Execution and acceptance

1. Lock behavior with layout, release contract and frontend mirror tests.
2. Move CLI code, executable, skills and templates together under
   `package/gitguardex`. Keep a private root workspace and compatibility paths
   for existing repository-local scripts. Build the release from the workspace,
   not the private root.
3. Move the independent Next.js app and lock under `package/frontend`. Update
   CI, dependency maintenance and mirror paths. The mirror must continue from
   its current head instead of overwriting its history after the move.
4. Group CLI implementation modules by worktree, pull requests and review.
   Retain existing behavior and explicit dependencies.
5. Run focused tests, lint, coverage, frontend verification, pack and installed
   CLI smoke before the ordinary Guardex review and CI gates.

Separate npm packages and separate release pipelines for individual CLI
capabilities are out of scope.

## Frontend mirror rollout prerequisite

GitHub reruns old workflows at their original revision; the new workflow alone
cannot stop a pre-migration run's force push. Before merging the layout change,
the mirror's `main` must have an active block on non-fast-forward pushes with no
bypass actors. This leaves the new mirror's ordinary fast-forward pushes allowed.

The configured mirror, `Webu-PRO/gitguardex-frontend`, has
[ruleset 28155280](https://github.com/Webu-PRO/gitguardex-frontend/rules/28155280).
Verified via the GitHub API that it is active on `refs/heads/main`, has no
bypass actors, and exposes `non_fast_forward` as an effective rule for `main`.
Keep this protection on any replacement mirror target.

The mirror script checks the protected source tree after fetching the mirror
parent. A stale checkout cannot publish a rollback as a fast-forward. The
regression test deploys the current frontend even when an unrelated commit
has advanced `main`, then verifies that deploying an older tree leaves the
mirror unchanged.
