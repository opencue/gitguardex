## ADDED Requirements

### Requirement: PR-time end-to-end coverage of `gx branch finish --via-pr` loop
The repository SHALL ship an end-to-end smoke test that drives the real `bin/multiagent-safety.js` through the full `gx branch finish --via-pr --wait-for-merge --cleanup` pipeline against a local-only fixture, and SHALL run that test on every pull request that touches the finish CLI surface.

#### Scenario: Local-only e2e harness drives the real finish pipeline
- **GIVEN** a checkout of this repository on a clean Ubuntu runner
- **WHEN** `bash test/e2e/finish-via-pr.sh` is executed
- **THEN** the harness creates a throwaway fixture repo plus a local bare origin
- **AND** it injects a `gh` mock through `GUARDEX_GH_BIN` so `gh pr merge` fast-forwards the bare origin's base branch with the agent branch's tree
- **AND** it runs `gx setup`, `gx branch start --tier T1 e2e-finish bot`, makes a single trivial commit inside the agent worktree, then runs `gx branch finish --branch <agent-branch> --base main --via-pr --wait-for-merge --cleanup`
- **AND** the script exits with status 0
- **AND** the script never contacts any external remote or the real `gh` CLI.

#### Scenario: Assertions cover the full commit -> PR -> merge -> cleanup loop
- **WHEN** the e2e harness completes successfully
- **THEN** it asserts the `gh` mock observed both `pr create` and `pr merge`
- **AND** the agent commit's marker file is present on `origin/main` after the mock-driven merge
- **AND** the local agent branch ref has been deleted
- **AND** the remote agent branch ref has been deleted
- **AND** the agent worktree directory no longer exists on disk
- **AND** the finish output contains the `Merged '<agent-branch>' into 'main' via pr flow` confirmation line.

#### Scenario: PR-scoped CI workflow
- **GIVEN** a pull request against `main` that modifies any of `bin/**`, `src/finish/**`, `src/cli/**`, `src/git/**`, `scripts/openspec/**`, `templates/scripts/agent-branch-finish.sh`, `templates/scripts/agent-branch-start.sh`, `test/e2e/**`, or `.github/workflows/e2e-finish.yml`
- **WHEN** the PR is opened, reopened, synchronized, or marked ready-for-review
- **THEN** the `e2e (finish flow)` workflow runs the harness on a `ubuntu-latest` runner with Node 20 and a 10-minute timeout
- **AND** the workflow is skipped on draft PRs and on PRs that do not touch the path filter
- **AND** the workflow remains available on-demand via `workflow_dispatch`.
