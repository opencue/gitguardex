## ADDED Requirements

### Requirement: Active Agents tree provider satisfies the VS Code contract
The Guardex Active Agents extension SHALL register a tree data provider that implements the tree item resolution contract required by `gitguardex.activeAgents`.

#### Scenario: Provider exposes tree item resolution
- **WHEN** the Active Agents extension activates
- **THEN** the registered provider exposes a callable `getTreeItem`
- **AND** rendering tree items does not throw `this._dataProvider.getTreeItem is not a function`.

#### Scenario: Regression coverage locks the provider contract
- **WHEN** the extension is exercised under the repo test harness with a mocked VS Code host
- **THEN** activation succeeds
- **AND** the regression test fails if the provider is registered without `getTreeItem`.
