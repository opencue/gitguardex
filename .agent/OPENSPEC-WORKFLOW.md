# Workflow (OpenSpec opt-in)

Guardex defaults to direct implementation in code and tests. OpenSpec becomes
the change SSOT only when the user requests it, an existing OpenSpec change is
being continued, or T2/T3 is explicitly selected.

## Versioning Rule

- If a change publishes or bumps a package version, the same change must also update the release notes / changelog entries. See [Documentation & Release Notes](#documentation--release-notes) for where to record change notes.

## OpenSpec philosophy (when active)

- fluid, not rigid
- iterative, not waterfall
- easy to apply, not process-heavy
- built for brownfield and greenfield work
- scalable from solo projects to large teams

## How to work (opt-in)

1. For routine work, edit code/tests directly and use the commit plus concise final handoff as the record. Do not create an OpenSpec workspace.
2. Activate the artifact-guided flow only when requested: `/opsx:propose <idea>` -> `/opsx:apply` -> `/opsx:archive`, or select T2/T3 explicitly.
3. Once active, keep proposal/spec/design/tasks aligned with meaningful behavior changes; update checkpoints at milestones, not after every tool call.
4. Explicit task scaffolds include a final PR merge + sandbox cleanup item and capture the PR URL plus `MERGED` evidence.
5. Validate active specs locally with `openspec validate --specs` and verify before archiving.

## OpenSpec tooling freshness (only when using OpenSpec)

- Keep the global CLI current:
  - `npm install -g @fission-ai/openspec@latest`
- Refresh project-local AI guidance/slash commands after updates:
  - `openspec update`
- If expanded workflow commands are needed (`/opsx:new`, `/opsx:continue`, `/opsx:ff`, `/opsx:verify`, `/opsx:sync`, `/opsx:bulk-archive`, `/opsx:onboard`), select a profile and refresh:
  - `openspec config profile <profile-name>`
  - `openspec update`

## Source of Truth

- **Specs/Design/Tasks (SSOT)**: `openspec/`
  - Active changes: `openspec/changes/<change>/`
  - Main specs: `openspec/specs/<capability>/spec.md`
  - Archived changes: `openspec/changes/archive/YYYY-MM-DD-<change>/`

## Documentation & Release Notes

- **Do not add/update feature or behavior documentation under `docs/`**. Use OpenSpec context docs under `openspec/specs/<capability>/context.md` (or change-level context under `openspec/changes/<change>/context.md`) as the SSOT.
- **Do not edit `CHANGELOG.md` directly.** Leave changelog updates to the release process; record change notes in OpenSpec artifacts instead.

### Documentation Model (Spec + Context)

- `spec.md` is the **normative SSOT** and should contain only testable requirements.
- Use `openspec/specs/<capability>/context.md` for **free-form context** (purpose, rationale, examples, ops notes).
- If context grows, split into `overview.md`, `rationale.md`, `examples.md`, or `ops.md` within the same capability folder.
- Change-level notes live in `openspec/changes/<change>/context.md` or `notes.md`, then **sync stable context** back into the main context docs.

Prompting cue (use when writing docs):
"Keep `spec.md` strictly for requirements. Add/update `context.md` with purpose, decisions, constraints, failure modes, and at least one concrete example."

## Commands (recommended)

- Opt-in flow: `/opsx:propose <idea>` -> `/opsx:apply` -> `/opsx:archive`
- Expanded flow start: `/opsx:new <kebab-case>`
- Continue artifacts: `/opsx:continue <change>`
- Fast-forward artifacts: `/opsx:ff <change>`
- Verify before archive: `/opsx:verify <change>`
- Sync delta specs → main specs: `/opsx:sync <change>`
- Bulk archive completed changes: `/opsx:bulk-archive`
- Guided onboarding workflow: `/opsx:onboard`
- Create/refresh plan workspace: `/opsx:plan <plan-slug>`
- Update plan checkpoint: `/opsx:checkpoint <plan-slug> <role> <checkpoint-id> <state> <text...> [--phase <phase-id>]` (`--phase` syncs the matching line in `openspec/plan/<slug>/phases.md` using the same `--state`)
- Watch team -> plan checkpoints: `/opsx:watch-plan <team-name> <plan-slug>`
