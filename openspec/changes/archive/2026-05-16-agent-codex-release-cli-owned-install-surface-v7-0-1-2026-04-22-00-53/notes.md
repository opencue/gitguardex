# agent-codex-release-cli-owned-install-surface-v7-0-1-2026-04-22-00-53 (minimal / T1)

- Bump the package metadata from `7.0.17` to `7.0.18` so the CLI-owned install-surface changes can ship under a fresh publishable npm version.
- Add a `README.md` release-notes entry for `v7.0.18` that documents the shipped `gx`-owned branch/lock/worktree/migrate surface, hook shims, smaller repo footprint, and user-level agent-skill install path.
- Keep the release scoped to metadata and operator-facing release history only; no runtime behavior changes are introduced in this follow-up.
- Verification:
  - `node --check bin/multiagent-safety.js`
  - `npm pack --dry-run`
  - `openspec validate --specs`
  - `openspec validate agent-codex-release-cli-owned-install-surface-v7-0-1-2026-04-22-00-53 --type change --strict` is intentionally not applicable to this T1 notes-only change because there are no delta specs.
