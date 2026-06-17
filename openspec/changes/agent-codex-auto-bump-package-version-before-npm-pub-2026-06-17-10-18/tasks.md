## 1. Specification

- [x] 1.1 Define the direct publish auto-bump behavior in `specs/release-workflow/spec.md`.
- [x] 1.2 Capture CI and dry-run skip rationale in `design.md`.

## 2. Implementation

- [x] 2.1 Add a `prepublishOnly` lifecycle hook to `package.json`.
- [x] 2.2 Add a publish helper that checks npm, bumps to the next unpublished patch version, and updates `package-lock.json` plus README release notes.
- [x] 2.3 Align committed release metadata to `7.1.1` after confirming npm already has `7.1.0`.
- [x] 2.4 Add regression coverage for version selection, manifest wiring, skip behavior, and file updates.

## 3. Verification

- [x] 3.1 Run targeted metadata and prepublish tests. Result: `node --test test/prepublish-bump-version.test.js test/metadata.test.js` passed.
- [ ] 3.2 Run `npm test`. Attempted, but the full suite produced no additional output for several minutes after the TAP header and was stopped with Ctrl-C to avoid leaving a stuck session.
- [x] 3.3 Run OpenSpec validation for this change. Result: `openspec validate agent-codex-auto-bump-package-version-before-npm-pub-2026-06-17-10-18 --type change --strict` passed.
- [x] 3.4 Run full spec validation. Result: `openspec validate --specs` passed with 133 specs.
- [x] 3.5 Run package dry-runs. Result: `env npm_config_cache=/tmp/npm-cache-gitguardex npm pack --dry-run` and `env npm_config_cache=/tmp/npm-cache-gitguardex npm publish --dry-run --access public` both reported `@imdeadpool/guardex@7.1.1`; publish dry-run ran `prepublishOnly` and skipped mutation because it was a dry run.

## 4. Completion

- [ ] 4.1 Finish the agent branch via PR merge + cleanup.
- [ ] 4.2 Record PR URL + final `MERGED` state in the completion handoff.
- [ ] 4.3 Confirm sandbox cleanup or capture a `BLOCKED:` handoff if merge/cleanup is pending.
