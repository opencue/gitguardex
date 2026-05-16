## Why

- `gx setup` and `gx doctor` currently copy workflow implementations, full hook files, repo-local skills, and `agent:*` package scripts into every consumer repo.
- That distribution model creates drift by design, which is why doctor needs protected-branch sandbox repair flows just to re-sync copied logic that actually belongs to the CLI package.
- Repo-local copies also make the public workflow noisy: consumers are taught to call pasted scripts instead of the `gx` CLI that owns the behavior.

## What Changes

- Add CLI-owned workflow subcommands for branch start/finish, lock operations, hook dispatch, worktree prune, repo migration, and user-level agent-skill installation.
- Replace installed repo hooks with tiny shims that dispatch into `gx hook run ...`.
- Stop setup/doctor from copying repo-local workflow implementations or repo-local skills, and stop injecting Guardex-managed `agent:*` package scripts into target repos while keeping repo-local dispatch shims.
- Add a `gx migrate` path that converts old-style installs to the new minimal repo footprint.
- Update docs, prompts, and managed templates to teach the `gx ...` surface instead of pasted script paths.

## Scope

- `bin/multiagent-safety.js`
- hook templates and package-owned workflow assets under `templates/`
- setup/doctor/install/migrate tests in `test/install.test.js`
- user-facing docs/templates (`README.md`, managed AGENTS block, skill templates)

## Risks

- Hook shims must still work in repos that only have the CLI on `PATH`; the tests need to lock that behavior.
- Existing repos may keep stale copied files until `gx migrate` runs, so migration must be conservative and explicit about what it removes.
- Setup/doctor/status output will change materially because the managed repo footprint is smaller.
