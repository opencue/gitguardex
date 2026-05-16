## 1. Specification

- [x] 1.1 Define acceptance criteria for OpenSpec file visibility in Source Control visual.
- [x] 1.2 Capture normative requirements in `specs/vscode-source-control-openspec-visual/spec.md`.

## 2. Implementation

- [x] 2.1 Update the Source Control SVG to match frontend style and show multiple active agents.
- [x] 2.2 Add `openspec/.../tasks.md` and `openspec/.../spec.md` file rows to each agent change list.
- [x] 2.3 Update README to reference the refreshed visual.

## 3. Verification

- [x] 3.1 Run `openspec validate agent-codex-vscode-source-control-openspec-visual-2026-04-20-12-25 --type change --strict`.
- [x] 3.2 Run `openspec validate --specs`.
- [x] 3.3 Confirm README image reference points to `docs/images/workflow-source-control.svg`.

## 4. Cleanup

- [x] 4.1 Ensure diff scope is limited to README + image + matching OpenSpec artifacts.
- [x] 4.2 Complete branch finish flow (`agent-branch-finish --via-pr --wait-for-merge --cleanup`).
- [x] 4.3 Record final PR URL and merge state.
