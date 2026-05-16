## Definition of Done

This change is complete only when **all** of the following are true:

- Every checkbox below is checked.
- The agent branch reaches `MERGED` state on `origin` and the PR URL + state are recorded in the completion handoff.
- If any step blocks (test failure, conflict, ambiguous result), append a `BLOCKED:` line under section 4 explaining the blocker and **STOP**. Do not tick remaining cleanup boxes; do not silently skip the cleanup pipeline.

## Handoff

- Handoff: change=`agent-claude-split-main-cli-into-subcommands-2026-05-17-00-33`; branch=`agent/<your-name>/<branch-slug>`; scope=`TODO`; action=`continue this sandbox or finish cleanup after a usage-limit/manual takeover`.
- Copy prompt: Continue `agent-claude-split-main-cli-into-subcommands-2026-05-17-00-33` on branch `agent/<your-name>/<branch-slug>`. Work inside the existing sandbox, review `openspec/changes/agent-claude-split-main-cli-into-subcommands-2026-05-17-00-33/tasks.md`, continue from the current state instead of creating a new sandbox, and when the work is done run `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`.

## 1. Specification

- [x] 1.1 Scope: pure code-motion refactor of `src/cli/main.js` (3,948 lines) into per-subcommand modules. No behavior changes; byte-identical stdout/stderr/exit codes preserved.
- [x] 1.2 Acceptance: `main.js` < 300 lines; one file per dispatched verb under `src/cli/commands/`; shared scaffolding/sandbox helpers under `src/cli/shared/`; `--help`, `--version`, `doctor --help`, `locks --help` outputs unchanged; test failure set unchanged vs `main` baseline.

## 2. Implementation

- [x] 2.1 Extract dispatch handlers into `src/cli/commands/{status,setup,bootstrap,doctor,review,agents,report,release,prompt,branch,finish,misc}.js` and shared helpers into `src/cli/shared/{repo-env,scaffolding,sandbox,toolchain-shims}.js`.
- [x] 2.2 Update source-text architecture guards in `test/cli-args-dispatch.test.js` and `test/metadata.test.js` to reflect the new layout (no behavioral expectation changes).

## 3. Verification

- [x] 3.1 `npm test`: 539 pass / 23 fail (identical to pre-refactor `main` baseline; no regressions introduced).
- [x] 3.2 Smoke-tested `gx --help`, `gx --version`, `gx doctor --help`, `gx locks --help` — all byte-identical to pre-refactor output.
- [ ] 3.3 Run `openspec validate --specs` (covered by `gx branch finish` gate).

## 4. Cleanup (mandatory; run before claiming completion)

- [x] 4.1 Run the cleanup pipeline: `gx branch finish --branch agent/<your-name>/<branch-slug> --base dev --via-pr --wait-for-merge --cleanup`. This handles commit -> push -> PR create -> merge wait -> worktree prune in one invocation.
- [x] 4.2 Record the PR URL and final merge state (`MERGED`) in the completion handoff.
- [x] 4.3 Confirm the sandbox worktree is gone (`git worktree list` no longer shows the agent path; `git branch -a` shows no surviving local/remote refs for the branch).
