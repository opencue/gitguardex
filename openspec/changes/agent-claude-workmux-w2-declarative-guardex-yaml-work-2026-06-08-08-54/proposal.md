## Why

A fresh agent worktree is a clean checkout: gitignored files (`.env`,
`node_modules`, `.venv`) don't exist, so agents start broken until someone
copies/links them. gitguardex already auto-provisions this — but only for the
hardcoded `apps/*` monorepo shape (symlink `apps/<pkg>/.env`, assign dev ports).
Any other repo layout gets nothing. workmux solves this declaratively with a
per-repo config (`files.copy`/`files.symlink` + `post_create` hooks); this ports
that idea so any repo can describe its own provisioning.

## What Changes

- Add a per-repo **`.guardex.json`** config (parsed with the existing
  `jsonc-parser`, so comments are allowed — no new dependency) with a
  `provision` block:

  ```jsonc
  { "provision": {
      "files": { "copy": [".env", "apps/*/.env"], "symlink": ["node_modules", ".venv"] },
      "postCreate": ["pnpm install --offline"] } }
  ```

- Add `src/scaffold/provision-config.js`: loader + a minimal dependency-free glob
  (literal segments + a single-segment `*`, e.g. `apps/*/.env`) + appliers for
  copy, symlink, and postCreate hooks. All best-effort: a missing config, a
  no-match pattern, or a failing hook never throws fatally.
- Wire it into `prepareAgentWorktree` (already auto-invoked on worktree
  creation) so declarative provisioning runs for **any** repo, ahead of the
  existing `apps/*` convenience which stays as the zero-config default.

## Impact

- Additive only; the existing `apps/*` env-symlink + dev-port behavior is
  unchanged (no longer gated behind an early-return, so non-monorepo repos now
  also get declarative provisioning).
- `copy`/`symlink` are pure filesystem ops. **Trust model:** `postCreate`
  executes shell commands from the repo owner's committed `.guardex.json` (same
  trust as `package.json` scripts or workmux `post_create`); it reads only the
  trusted repo-root config, logs each command, is non-fatal, and is disabled
  with `GUARDEX_PROVISION_HOOKS=0`.
- Glob is intentionally minimal (one `*` per segment, no `**`/braces); patterns
  with absolute paths or `..` are rejected to keep provisioning inside the repo.
- Affected: `src/scaffold/provision-config.js` (new),
  `src/scaffold/agent-worktree-prep.js`, `test/provision-config.test.js` (new).
