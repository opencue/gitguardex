## Why

- Operators currently have to run `specify init --here --ai claude --force --ignore-agent-tools` by hand after every `gx setup` to wire Spec Kit's SDD slash skills into a repo, then manually delete the heavy auto-generated `openspec/plan/agent-…-masterplan-setup-spec-kit-…/` and `openspec/changes/agent-…-setup-spec-kit-…/specs/` scaffolds. Bake this into gx so one command does it cleanly.

## What Changes

- New `src/speckit/index.js` module exposing `runSpeckitCommand(rawArgs)`, `installSpeckit({ target, dryRun, prune })`, and helpers.
- New `gx speckit` subcommand wired into `src/cli/main.js` dispatch.
- New CLI catalog entry in `src/context.js` (both the flat `CLI_COMMAND_DESCRIPTIONS` list and the grouped `CLI_COMMAND_GROUPS` "Agents & reports" section).
- `gx speckit` flow:
  1. Probes `specify` on `PATH`; prints install hint and exits if missing.
  2. Runs `specify init --here --ai claude --force --ignore-agent-tools` in the target repo.
  3. Prunes auto-created `openspec/plan/agent-…-masterplan-setup-spec-kit-…/` and `openspec/changes/agent-…-setup-spec-kit-…/specs/` scaffolds (toggle via `--no-prune`).
  4. Prints next-steps mentioning `gx pivot` for the agent-worktree flow (kept unchanged).
- Supported flags: `--target <path>`, `--no-prune`, `--prune`, `--dry-run`, `-h/--help`.

## Impact

- Existing `gx setup`, `gx pivot`, `gx finish`, and `gx cleanup` behavior is unchanged — speckit install is a separate opt-in subcommand.
- No new runtime dependencies; `specify` is invoked only when present on `PATH`.
- New module is isolated under `src/speckit/`; only two trivial dispatch wiring edits in `src/cli/main.js` and two catalog entries in `src/context.js`.
- The 23 pre-existing test failures in `branch.test.js`, `cockpit-*.test.js`, and `welcome.test.js` are unrelated to this change.
