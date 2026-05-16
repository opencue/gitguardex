## Why

- `src/cli/main.js` still mirrors constants and helper implementations that already exist in `src/context.js`, `src/output/index.js`, and `src/scaffold/index.js`.
- Those mirrors already drifted: `MANAGED_GITIGNORE_PATHS`, `CLI_COMMAND_DESCRIPTIONS`, and `MAINTAINER_RELEASE_REPO` disagree across modules, so whichever copy a caller reaches changes behavior.
- The current follow-up should stay mechanical: delete dead/duplicate helpers, make the extracted modules the only source of truth, and lock the drift cases with focused tests.

## What Changes

- Import shared constants/session helpers from `src/context.js` instead of redefining them in `src/cli/main.js`.
- Import presentation helpers from `src/output/index.js` and scaffold/file-install helpers from `src/scaffold/index.js`, then delete the local mirrors in `src/cli/main.js`.
- Remove dead or duplicated helpers in `src/cli/main.js`, including the duplicate `gitRefExists`, duplicate auto-finish failure log, unused command handlers, unused prompt helper, and redundant truthy-flag wrapper.
- Add focused regression coverage for the shared-source ownership and the concrete drift cases (`--current` help text, `.vscode` gitignore exceptions, and maintainer release repo resolution).

## Impact

- Primary files: `src/cli/main.js`, `src/context.js`, `src/output/index.js`, `src/scaffold/index.js`, and `test/cli-args-dispatch.test.js`.
- Main risk is behavior drift while deleting local copies, so verification stays focused on syntax plus targeted CLI regression suites before broader checks.
