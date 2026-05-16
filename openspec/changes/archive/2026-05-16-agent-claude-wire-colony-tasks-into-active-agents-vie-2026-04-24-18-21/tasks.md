## 1. Specification

- [x] 1.1 Finalize proposal scope and acceptance criteria for `agent-claude-wire-colony-tasks-into-active-agents-vie-2026-04-24-18-21`.
- [x] 1.2 Define normative requirements in `specs/wire-colony-tasks-into-active-agents-view/spec.md`.

## 2. Implementation

- [x] 2.1 Add `node:http` + `node:os` imports and colony config helpers (`colonyDataDir`, `readColonyPort`, `fetchColonyJson`, `readColonyTasksForRepo`, `compactColonyBranchLabel`) to `vscode/guardex-active-agents/extension.js`.
- [x] 2.2 Thread `colonyTasks` through `buildRepoOverview`, `buildOverviewDescription`, `annotateRepoEntries`, `RepoItem`, and the `loadRepoEntries` fan-out in `vscode/guardex-active-agents/extension.js`.
- [x] 2.3 Render a collapsed `Colony tasks` section inside `Advanced details` in `getChildren(RepoItem)` with per-task `DetailItem`s showing participants and pending handoff count.

## 3. Verification

- [x] 3.1 `node --check vscode/guardex-active-agents/extension.js` exits 0.
- [ ] 3.2 Manual smoke: run extension against a repo with an active colony worker and confirm the colony task counts appear in the Overview description and the `Colony tasks` section lists tasks correctly.

## 4. Cleanup

- [x] 4.1 Run `gx branch finish --branch agent/claude/wire-colony-tasks-into-active-agents-vie-2026-04-24-18-21 --base main --via-pr --wait-for-merge --cleanup`.
- [x] 4.2 Record PR URL + `MERGED` state and confirm sandbox worktree removed.
