## 1. Spec

- [x] 1.1 Capture rename + token-budget intent in proposal/spec.

## 2. Tests

- [x] 2.1 Update install/metadata expectations for `gitguardex` paths and CLI output.

## 3. Implementation

- [x] 3.1 Rename primary CLI/skill/command surfaces to `gitguardex`.
- [x] 3.2 Slim the always-loaded AGENTS/skill/command text.
- [x] 3.3 Refresh docs/help text to match the new primary surface.

## 4. Verification

- [x] 4.1 Run targeted verification (`node --test test/install.test.js test/metadata.test.js`, `node --check bin/multiagent-safety.js`, `npm pack --dry-run`).
- [x] 4.2 Run `openspec validate agent-codex-rename-guardex-to-gitguardex-and-slim-fi-2026-04-21-01-29 --type change --strict`.

## 5. Cleanup

- [x] 5.1 Finish branch via PR merge + cleanup and record final `MERGED` evidence.
