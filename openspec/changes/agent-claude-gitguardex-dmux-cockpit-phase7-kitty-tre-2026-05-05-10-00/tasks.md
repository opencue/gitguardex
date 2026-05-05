# Tasks

## 1. Spec
- [x] 1.1 Capture proposal in `proposal.md`
- [x] 1.2 Capture spec delta in `specs/cockpit-kitty-tree/spec.md`

## 2. Tests
- [x] 2.1 Add `test/cockpit-kitty-tree.test.js` covering
       `buildLsArgs`, `classifyWindow`, `flattenOsWindow`,
       `pickOsWindow`, `readKittyTree` (with and without
       `KITTY_LISTEN_ON`), and the rendered sidebar tree (with and
       without state).

## 3. Implementation
- [x] 3.1 Add `src/cockpit/kitty-tree.js` with `readKittyTree`,
       `flattenOsWindow`, `classifyWindow`, `pickOsWindow`,
       `buildLsArgs`, `userLabel`, `buildSessionLabel`, and
       `emptyTree`.
- [x] 3.2 Add `renderKittyTreeRows` to `src/cockpit/sidebar.js` and
       insert it into `renderSidebar` between the agent lanes block
       and the shortcut block.

## 4. Cleanup
- [ ] 4.1 Commit changes on the agent branch.
- [ ] 4.2 Push branch and open a PR.
- [ ] 4.3 Run `gx branch finish ... --via-pr --wait-for-merge --cleanup`.
- [ ] 4.4 Record PR URL and `MERGED` evidence.
