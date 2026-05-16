## 1. Spec

- [x] 1.1 Define the CLI-owned install surface and minimal repo footprint in `specs/cli-owned-install-surface/spec.md`.
- [x] 1.2 Update the proposal/tasks to reflect the migration constraints and cleanup goal.

## 2. Tests

- [x] 2.1 Add or update install/setup/doctor regressions for the new minimal repo footprint:
  - hooks install as `gx hook run ...` shims
  - setup/doctor keep repo-local dispatch shims but stop copying workflow implementations or repo-local skills
  - migration converts old-style installs and removes Guardex-managed `agent:*` package scripts
- [x] 2.2 Add coverage for the new CLI-owned command surface (`gx branch ...`, `gx locks ...`, `gx worktree prune`, `gx migrate --install-agent-skills` as applicable).

## 3. Implementation

- [x] 3.1 Add CLI-owned workflow subcommands and package-asset execution paths in `bin/multiagent-safety.js`.
- [x] 3.2 Convert installed hook templates to shims and route hook logic through package-owned assets.
- [x] 3.3 Remove repo-local workflow implementation/skill/package-script installation from setup/doctor while preserving AGENTS, hook/workflow shims, lock state, and managed gitignore behavior.
- [x] 3.4 Add `gx migrate` and user-level skill installation support.
- [x] 3.5 Update docs/templates/prompts to teach the `gx` surface instead of pasted repo scripts.

## 4. Verification

- [x] 4.1 Run `node --check bin/multiagent-safety.js`.
- [x] 4.2 Run the focused install/doctor suite: `node --test test/install.test.js`.
- [x] 4.3 Run `openspec validate agent-codex-cli-owned-install-surface-2026-04-21-23-09 --type change --strict`.
- [x] 4.4 Run `openspec validate --specs`.

## 5. Cleanup

- [x] 5.1 Confirm the OpenSpec tasks reflect the shipped behavior and note any deferred follow-ups.
- [x] 5.2 Finish the agent branch via PR merge + cleanup (`gx finish --via-pr --wait-for-merge --cleanup` or `bash scripts/agent-branch-finish.sh --branch <agent-branch> --base <base-branch> --via-pr --wait-for-merge --cleanup`).
- [x] 5.3 Record PR URL + final `MERGED` evidence in the completion handoff.
