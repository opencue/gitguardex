# Proposal: canonicalize `scripts/` ↔ `templates/scripts/` as symlinks + CI parity guard

## Problem

`scripts/agent-branch-{start,finish,merge}.sh` and several sibling files are tracked twice in this repo: once under `scripts/` and once under `templates/scripts/`. The gx CLI invokes the `templates/scripts/` copies at runtime (see `src/context.js:247`, `PACKAGE_SCRIPT_ASSETS`), and scaffolds the `scripts/` copies into consumer repos as legacy workflow shims (`LEGACY_WORKFLOW_SHIM_SPECS`, line 180). The two copies have no enforced parity. PRs touch one and forget the other, and the drift is invisible until something breaks in the runtime invocation that nobody tested.

This bit us this session: PR #546 fixed an auto-transfer leak in `scripts/agent-branch-start.sh` but the runtime path under `templates/scripts/agent-branch-start.sh` was unchanged, so the user-visible bug remained live until PR #547 re-applied the fix in the runtime copy. A subsequent inventory found 10 of 12 paired files already identical and only 2 drifting — the exact two that PRs #546 and #545 had touched.

## Approach

Replace the `scripts/` copy of every paired file with a symlink into `../templates/scripts/`. The runtime path stays canonical; the legacy shim path becomes a transparent alias. A new `scripts/check-script-symlinks.sh` asserts the invariant and runs in CI.

### Concrete changes

1. **Replace 10 files in `scripts/` with symlinks** into `../templates/scripts/` (or `../../templates/scripts/openspec/` for the two openspec/ subfiles):

   - `scripts/agent-branch-start.sh`
   - `scripts/agent-branch-finish.sh`
   - `scripts/agent-branch-merge.sh`
   - `scripts/agent-file-locks.py`
   - `scripts/agent-worktree-prune.sh`
   - `scripts/codex-agent.sh`
   - `scripts/install-agent-git-hooks.sh`
   - `scripts/review-bot-watch.sh`
   - `scripts/openspec/init-change-workspace.sh`
   - `scripts/openspec/init-plan-workspace.sh`

   For each, the symlink target before this change was structurally identical to the matching `templates/scripts/<file>` for 8 of 10. For the 2 drifted files (`agent-branch-start.sh`, `agent-branch-finish.sh`), the `templates/` version is the source of truth and is what runtime executes; making the `scripts/` copy a symlink discards no unique content (the drift was in the `scripts/` copy and was never invoked).

2. **Add `scripts/check-script-symlinks.sh`**, a single-purpose verifier: enumerate the required-symlink list and assert each path is a symlink with the expected `../templates/scripts/<basename>` target. Exits non-zero on any drift with explicit fix-hints.

3. **Wire the check into `.github/workflows/ci.yml`** as a new step under the existing test job, between the CLI static-check and the `npm pack --dry-run` step. This catches anyone who tries to replace a symlink with a regular file in a PR.

### Out of scope

- `scripts/guardex-env.sh`, `scripts/guardex-docker-loader.sh`, `scripts/agent-session-state.js`, `scripts/install-vscode-active-agents-extension.js`: tracked under `.gitignore` for `scripts/` (they're consumer-scaffolded local outputs), not symlinked.
- Pre-commit hook integration: the existing `.githooks/pre-commit` delegates to `gx hook run pre-commit`, which is a wider system. Adding a parity gate there is a separate scope; CI alone is enough for the catch-window we need.
- A `gx scripts sync` command that programmatically refreshes the symlinks: not needed today, just `rm + ln -s` works.

## Rationale

- The symlink pattern is already established for `CLAUDE.md → AGENTS.md` in this repo. New contributors are not surprised by it.
- Single-source-of-truth via filesystem is cheaper than a two-way sync script — there is no "stale" state to detect, because the symlinks make staleness impossible by construction.
- CI parity check protects against the only remaining failure mode: someone explicitly removing the symlink and committing a regular file in its place.

## Compatibility

- `bash ./scripts/agent-branch-start.sh ...`, `python3 scripts/agent-file-locks.py ...`, `npm run agent:branch:start` (which expands to `bash ./scripts/agent-branch-start.sh`) all follow symlinks transparently. No invocation surface changes.
- Scaffolding into consumer repos via `gx setup` continues to materialize a regular file at `<consumer>/scripts/<name>` (the scaffold code reads from `TEMPLATE_ROOT/scripts/...` and writes to the consumer's `scripts/...`; it does not propagate symlinks). Consumer repos are unaffected.
- Linux/macOS: symlinks work natively. Windows: requires `core.symlinks=true` plus developer mode or admin. The repo already requires this for `CLAUDE.md`, so the constraint is unchanged.

## Risks

- A `gx setup --repair` invocation against the gitguardex repo itself might overwrite the symlinks with regular files (since it follows the template-to-destination scaffold path that does not know to preserve symlinks). If this becomes an issue, the symptom would be: CI fails the parity check on the next PR. Mitigation: the user re-runs the manual `rm + ln -s` recipe documented in the parity-check failure message.
- A future contributor who edits `scripts/<file>` directly via an editor that resolves symlinks before writing would silently edit `templates/scripts/<file>`. This is desired behavior, not a risk.
