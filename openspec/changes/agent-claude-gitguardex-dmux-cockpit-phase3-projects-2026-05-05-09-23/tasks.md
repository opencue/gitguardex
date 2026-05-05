# Tasks

## 1. Spec
- [x] 1.1 Capture proposal in `proposal.md`
- [x] 1.2 Capture spec delta in `specs/cockpit-projects/spec.md`

## 2. Tests
- [x] 2.1 Add `test/cockpit-projects.test.js` covering
       `findProjects`, `defaultRoots`, `expandHome`, projects-mode
       navigation, enter-emits-intent, and the rendered panel.
- [x] 2.2 Verify existing cockpit-control tests still pass.

## 3. Implementation
- [x] 3.1 Add `src/cockpit/projects-finder.js` with `findProjects`,
       `defaultRoots`, `expandHome`, `walkRoot`, `uniqueRoots`,
       `SKIP_NAMES`.
- [x] 3.2 Replace placeholder `renderProjectsPanel` in
       `src/cockpit/control.js` with a real list view (cursor, current
       marker, empty state, root listing, footer hints).
- [x] 3.3 Add `loadProjectsState` helper and call it from
       `openActionRow('projects')` so the list is hydrated lazily.
- [x] 3.4 In `applyKey`, add `up`/`down`/`j`/`k` navigation, `r`
       rescan, and `enter` `project:switch` intent emission for
       `projects` mode.

## 4. Cleanup
- [ ] 4.1 Commit changes on the agent branch.
- [ ] 4.2 Push branch and open a PR.
- [ ] 4.3 Run `gx branch finish ... --via-pr --wait-for-merge --cleanup`.
- [ ] 4.4 Record PR URL and `MERGED` evidence.
