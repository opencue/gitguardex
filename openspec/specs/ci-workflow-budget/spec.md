# ci-workflow-budget Specification

## Purpose
TBD - created by archiving change agent-claude-budget-friendly-ci-templates-2026-05-14-00-52. Update Purpose after archive.
## Requirements
### Requirement: Live workflows carry a budget posture
Every GitHub Actions workflow in `.github/workflows/` of this repo SHALL:

- declare `concurrency:` with a per-ref group name and `cancel-in-progress: true`, **OR** be explicitly exempted with an inline comment explaining why superseded runs must not cancel (e.g. release publication on a tag),
- omit the `push: branches: [main]` trigger when the workflow's purpose is "validate before merge" (CI, CodeQL, Scorecard), since branch protection forces all changes through a PR and post-merge re-runs are duplication,
- include `ready_for_review` in `pull_request.types` when the workflow's per-PR job is gated by `pull_request.draft == false`.

#### Scenario: ci.yml gated on draft
- **GIVEN** the live `.github/workflows/ci.yml`
- **WHEN** parsed by a YAML loader
- **THEN** it MUST declare `concurrency: cancel-in-progress: true`
- **AND** its `test` job MUST set `if: github.event_name != 'pull_request' || github.event.pull_request.draft == false`
- **AND** its `on.pull_request.types` MUST contain `ready_for_review`
- **AND** it MUST NOT declare a `push: branches: [main]` trigger.

#### Scenario: codeql.yml runs on schedule, not per-PR
- **GIVEN** the live `.github/workflows/codeql.yml`
- **WHEN** parsed by a YAML loader
- **THEN** its `on` block MUST contain a `schedule:` entry
- **AND** its `on` block MUST contain `workflow_dispatch:`
- **AND** its `on` block MUST NOT contain a `pull_request:` or `push:` trigger.

#### Scenario: no AI-code-review workflow ships or is scaffolded
- **GIVEN** the live `.github/workflows/` directory and the `templates/github/workflows/` directory
- **THEN** neither MUST contain a `cr.yml` (or any other AI-code-review) workflow
- **AND** AI review SHALL be driven from the CLI (`gx review`, `gx branch finish --gate-review`), which fails closed when no review provider is configured, rather than from a per-PR workflow that reports a passing check when its `OPENAI_API_KEY` secret is unset.

### Requirement: Templates seed the same posture in downstream projects
The `templates/github/workflows/` directory SHALL carry workflow files that bootstrap the same budget posture into a downstream gitguardex-managed project.

#### Scenario: Templates exist and parse
- **GIVEN** the `templates/github/workflows/` directory in this repo
- **THEN** it MUST contain `ci.yml`, `ci-full.yml`, and `README.md`
- **AND** each `.yml` file MUST parse cleanly with a standard YAML loader
- **AND** each `.yml` template MUST carry the same `concurrency:` + `if: draft == false` (or equivalent agent-skip) posture as the live file it mirrors.

