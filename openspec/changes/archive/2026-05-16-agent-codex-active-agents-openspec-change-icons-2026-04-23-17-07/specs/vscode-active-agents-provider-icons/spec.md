## ADDED Requirements

### Requirement: Changed OpenSpec rows keep semantic file icons

The Active Agents tree SHALL keep semantic OpenSpec file icons for changed rows when the row only carries delta metadata and no real warning state.

#### Scenario: Delta-only proposal, tasks, and spec rows keep semantic icons

- **GIVEN** an unassigned Active Agents change row points at `proposal.md`, `tasks.md`, or `spec.md`
- **AND** the row only carries normal change metadata such as `deltaLabel: Updated`
- **WHEN** the tree renders that row
- **THEN** the row keeps the bundled semantic icon that matches the shipped file-icon manifest
- **AND** the description still surfaces the delta label

#### Scenario: Warning states still override semantic file icons

- **GIVEN** an Active Agents change row is on a protected branch, has a foreign lock, or carries a lock warning
- **WHEN** the tree renders that row
- **THEN** the row continues to use the generic warning icon instead of a semantic workflow file icon
