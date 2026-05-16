## ADDED Requirements

### Requirement: Source Control visual includes OpenSpec artifacts per agent
The Source Control tutorial visual SHALL show that each active agent branch can include OpenSpec artifacts in its change list.

#### Scenario: Agent branch lists OpenSpec tasks
- **WHEN** the Source Control visual is rendered
- **THEN** each depicted active agent lane includes an `openspec/.../tasks.md` entry in `Changes`.

#### Scenario: Agent branch lists OpenSpec capability spec
- **WHEN** the Source Control visual is rendered
- **THEN** each depicted active agent lane includes an `openspec/.../specs/.../spec.md` entry in `Changes`.

### Requirement: README references the refreshed Source Control visual
The README SHALL point the Source Control section to the updated visual asset that includes OpenSpec file entries.

#### Scenario: Reader opens Source Control section
- **WHEN** a reader scans the Source Control layout section in README
- **THEN** the embedded image resolves to the updated `workflow-source-control.svg` asset.
