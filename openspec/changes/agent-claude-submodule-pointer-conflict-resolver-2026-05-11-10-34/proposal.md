# Proposal: deploy PR #546's fix to runtime via `templates/scripts/` + add `--auto-resolve=full` submodule pointer resolver

## Problem

Two issues, both surfaced by trying to use PR #546 in anger.

### 1. PR #546 did not actually deploy at runtime

The Guardex Node CLI invokes `templates/scripts/agent-branch-{start,finish}.sh` (see `src/context.js:247`), not `scripts/agent-branch-{start,finish}.sh`. Both copies are tracked in git, drift independently, and PR #546 modified only the `scripts/` copy. At runtime the leak the PR claimed to fix is still live.

Reproduction: in a worktree containing PR #546's merge commit, run `gx branch start --no-transfer ...`. The CLI errors with `Unknown option: --no-transfer` from `templates/scripts/agent-branch-start.sh`. The fix needs to land in the `templates/` copy.

### 2. Submodule pointer conflicts remain unresolved

PR #546's `--auto-resolve=safe` only matches state-file globs. Real-world PR conflicts (see the user's downstream `Webu-PRO/lifted.sk-backend` PR #3) include submodule pointers (`apps/backend`, `apps/storefront`), which `safe` mode correctly refuses. There is no auto-resolution path for them today; the PR sits blocked.

## Approach

### 1. Port Phase 1+2 to `templates/scripts/`

Apply PR #546's auto-transfer exclude + `--no-transfer` flag set to `templates/scripts/agent-branch-start.sh`. Apply PR #546's `--auto-resolve=safe` resolver (with `gx locks claim` integration and pre-commit-hook compliance) to `templates/scripts/agent-branch-finish.sh`. After this PR, both `scripts/` and `templates/scripts/` carry the same fix.

### 2. Add `--auto-resolve=full` mode (submodule pointer resolver)

Extend the existing `--auto-resolve` enum from `{none, safe}` to `{none, safe, full}`. `full` keeps safe's state-file behavior and adds a submodule-pointer-only resolver:

- Detects whether a conflict path is a registered submodule via `.gitmodules`.
- Reads the three index stages (base/ours/theirs) via `git ls-files -u`.
- Determines ancestry using a working clone of the submodule. The clone is selected in order:
  1. The checked-out submodule worktree (no network).
  2. The cached internal clone at `.git/modules/<path>` (no network, present even after `git submodule deinit`).
  3. A temporary bare clone of the submodule URL from `.gitmodules` (network, cleaned up via RETURN trap).
- If one SHA is a strict ancestor of the other, picks the descendant and writes it via `git update-index --cacheinfo 160000,<sha>,<path>`. Otherwise refuses.
- Claims the resolved submodule paths via `gx locks claim` before committing, matching the state-file flow.

### What's still out of scope

- Auto-fetching from remotes the user does not have credentials for.
- Resolving divergent submodule histories (refuse-by-design).
- AI-driven code-conflict resolution.

## Rationale

- Modern git already auto-fast-forwards submodule pointers when both SHAs are reachable locally — so the resolver is most useful when no clone is present (shallow CI agents, deinit'd submodules, GitHub-server-side merge attempts). Path 3 (temp bare clone) closes the gap.
- Strict ancestry-only matches the user's PR #3 shape: GitHub flags the conflict because *it* doesn't have a clone; once a clone exists, ancestry is trivially decidable.
- Keeping the resolver opt-in (`--auto-resolve=full`) preserves the safe-by-default invariant from PR #546.

## Compatibility / Migration

- The `--auto-resolve=safe` value continues to behave exactly as in PR #546 (state files only).
- New value `--auto-resolve=full` is opt-in; default is still `none`.
- No env vars renamed. New default for `AUTO_RESOLVE_SAFE_GLOBS` remains unchanged.
- The `templates/` copy gains the same flags as the `scripts/` copy. No drift introduced in the touched regions.

## Risks / Known follow-ups

- `templates/scripts/` and `scripts/` continue to drift in untouched regions. This PR keeps the touched regions in sync but does not solve the structural duplication. Recommended follow-up: a parity-check CI script or a build step that makes one the canonical source. Track as a separate change.
- The temp bare-clone path executes `git clone` against the submodule URL — for HTTPS submodules the user's existing credentials carry over; for `file://` test fixtures, callers need `protocol.file.allow=always`.
- The trap-based cleanup of the temp clone runs on function return; if the shell is killed mid-function the temp dir leaks. Acceptable given the size and the mktemp prefix `gx-submod-resolve-`.
