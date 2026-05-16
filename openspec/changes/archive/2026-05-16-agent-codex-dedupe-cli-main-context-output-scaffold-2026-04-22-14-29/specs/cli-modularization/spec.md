## MODIFIED Requirements

### Requirement: Module seams mirror operational responsibility
The CLI SHALL keep shared helper ownership in the extracted `src/` modules instead of duplicating the same constants or helper implementations in `src/cli/main.js`.

#### Scenario: Shared context/output/scaffold seams stay single-source
- **WHEN** maintainers inspect `src/cli/main.js`
- **THEN** shared constants and session helpers are imported from `src/context.js`
- **AND** presentation helpers are imported from `src/output/index.js`
- **AND** scaffold/file-install helpers are imported from `src/scaffold/index.js`
- **AND** `src/cli/main.js` does not redefine those helpers locally.

### Requirement: Refactor preserves targeted CLI behavior
The modularization SHALL preserve the current command surface for targeted verified flows while deleting the local duplicate helpers.

#### Scenario: Shared-source drift cases remain stable after cleanup
- **WHEN** focused CLI regression suites are run after the helper cleanup
- **THEN** setup and doctor help continue advertising `--current`
- **AND** managed gitignore handling preserves the `.vscode` exceptions required for shared settings
- **AND** release gating resolves the default maintainer repo to the package root instead of the `src/` directory
- **AND** syntax/require-time failures do not occur from duplicate helper definitions.
