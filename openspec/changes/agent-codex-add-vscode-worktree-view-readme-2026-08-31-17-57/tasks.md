## Definition of Done

- Every checkbox below is checked.
- The PR reaches `MERGED`, its URL is recorded, and the sandbox is removed.
- If a blocker remains, append a `BLOCKED:` line and stop.

## 1. Specification

- [x] 1.1 Define the opt-in discovery behavior and default safety boundary.
- [x] 1.2 Define the README visual outcome.

## 2. Regression coverage

- [x] 2.1 Cover the new setup alias and its inverse.
- [x] 2.2 Cover the generated multi-root workspace folders and discovery settings.

## 3. Implementation

- [x] 3.1 Implement the explicit VS Code worktree-view option.
- [x] 3.2 Add the dark capability visual and supplied VS Code screenshot.
- [x] 3.3 Restructure the README capability section and document the command.

## 4. Verification

- [x] 4.1 Run targeted tests and changed-file quality checks.
- [x] 4.2 Validate the OpenSpec change and specs.
- [x] 4.3 Render and inspect the README visuals in a browser.

## 5. Completion and cleanup

- [ ] 5.1 Run `gx branch finish --branch agent/codex/add-dark-structured-readme-capability-vi-2026-08-31-17-57 --base main --via-pr --wait-for-merge --cleanup --no-preflight`.
- [ ] 5.2 Record the PR URL and final `MERGED` state.
- [ ] 5.3 Confirm the temporary branch and worktree were removed.
