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
