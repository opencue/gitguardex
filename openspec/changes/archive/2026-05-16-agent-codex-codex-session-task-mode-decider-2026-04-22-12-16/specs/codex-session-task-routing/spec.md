## ADDED Requirements

### Requirement: Guardex branch start honors OpenSpec tiers
`gx branch start` SHALL apply the requested OpenSpec tier instead of always creating the full T3 scaffold.

#### Scenario: T1 branch start creates a notes-only change workspace
- **WHEN** an operator runs `gx branch start --tier T1 ...`
- **THEN** Guardex creates the agent branch/worktree
- **AND** it initializes `openspec/changes/<change>/notes.md` plus `.openspec.yaml`
- **AND** it does not create `proposal.md`, `tasks.md`, or an `openspec/plan/<plan>/` workspace.

#### Scenario: T2 branch start skips the plan workspace
- **WHEN** an operator runs `gx branch start --tier T2 ...`
- **THEN** Guardex creates the full change workspace with `proposal.md`, `tasks.md`, and `specs/.../spec.md`
- **AND** it does not create an `openspec/plan/<plan>/` workspace.

#### Scenario: T3 branch start keeps the full scaffold
- **WHEN** an operator runs `gx branch start --tier T3 ...`
- **THEN** Guardex creates both the full change workspace and the plan workspace.

### Requirement: Codex launcher auto-routes task size into mode plus tier
The Codex launcher SHALL classify the requested task before starting the sandbox and choose the lightweight or OMX lane accordingly.

#### Scenario: explicit lightweight task routes to caveman and T1
- **WHEN** `scripts/codex-agent.sh` launches a task whose text starts with `quick:`, `simple:`, `tiny:`, `minor:`, `small:`, `just:`, or `only:`
- **THEN** it reports a `caveman` task mode
- **AND** it starts the sandbox with OpenSpec tier `T1`
- **AND** the launched Codex process receives the selected mode/tier in its environment.

#### Scenario: non-trivial task routes to OMX-backed tiers
- **WHEN** `scripts/codex-agent.sh` launches a broader behavior/refactor/workflow task without a lightweight prefix
- **THEN** it reports an `omx` task mode
- **AND** it selects `T2` by default
- **AND** it upgrades to `T3` for clearly plan-heavy or orchestration-heavy requests.

### Requirement: active session records capture the routing decision
The active session record written for Codex sandboxes SHALL preserve the selected task mode and OpenSpec tier.

#### Scenario: active session record stores mode plus tier
- **WHEN** `scripts/agent-session-state.js start ...` is called with task-routing metadata
- **THEN** the written `.omx/state/active-sessions/*.json` record includes the selected task mode, OpenSpec tier, and routing reason.
