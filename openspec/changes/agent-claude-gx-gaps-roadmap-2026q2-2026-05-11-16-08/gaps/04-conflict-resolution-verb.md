# Gap 04 — Conflict resolution verb (`gx resolve`)

## Problem

When two agent lanes both touch `.gitmodules`, a lockfile (`pnpm-lock.yaml`, `package-lock.json`, `Cargo.lock`), or a generated artifact (built CSS, generated OpenAPI client, schema dumps), the lanes collide at merge time. gx has no primitive for this. Agents drop to raw `git merge`, `git rebase --strategy-option=ours`, or `git checkout --theirs` — each of which can quietly destroy work in a sparse-checkout agent worktree.

The pattern is recurring and well-known internally: an existing `submodule-pointer-conflict-resolver` agent worktree has been sitting open with no commits for hours (visible in `git worktree list`), because the conflict-handling story is ambiguous enough that the agent declined to act.

## Evidence in current code

- `git worktree list` includes `agent/codex/...submodule-pointer-conflict-resolver` lanes with zero commits.
- `src/submodule/index.js` has `advance()` for forward-only pointer bumps but no merge-strategy support.
- `src/finish/index.js:241 finish()` calls `branchFinish` asset; no pre-merge conflict-resolution hook.
- Memory 5001: "submodule-pointer-conflict-resolver Worktree Is Freshly Created with No New Commits Yet" — observed pattern.

## Proposed CLI surface

```bash
gx resolve <path...>                                  # inspect, print plan, no actions
gx resolve <path...> --strategy=<name>                # apply strategy
gx resolve --auto                                     # scan whole worktree, pick strategy per path
```

Strategies (each path-class has one default):

- `--strategy=submodule-tip`     → for `.gitmodules` collisions: take the newer remote tip of every submodule. Refuses if either submodule has uncommitted work.
- `--strategy=lockfile-regen`    → for lockfiles: delete, re-run the matching package manager (`pnpm install`, `npm install`, `cargo update`), commit the result.
- `--strategy=generated-rebuild` → for declared generated artifacts: delete, run the registered rebuild command (from `package.json` `scripts.<key>` or `.gx/resolve.json`), commit.
- `--strategy=ours` / `--strategy=theirs` → escape hatches; warn loudly.

`.gx/resolve.json` (new, optional) declares per-path strategies so `--auto` knows what to do without a flag:

```json
{
  "rules": [
    { "path": "pnpm-lock.yaml",      "strategy": "lockfile-regen", "command": "pnpm install --frozen-lockfile=false" },
    { "path": ".gitmodules",         "strategy": "submodule-tip" },
    { "path": "apps/docs/openapi.json", "strategy": "generated-rebuild", "command": "pnpm --filter docs gen:openapi" }
  ]
}
```

## Tier / effort

- **Tier**: T2.
- **Effort**: ~8 files / ~2 days. New `src/resolve/index.js` + dispatch entry + `.gx/resolve.json` reader + per-strategy implementations + tests + docs entry in the relevant capability context.

## Dependencies

- **Soft on Gap 02** (Structured observability): `gx resolve` should emit `resolve-applied` events so repeat collisions are visible in `gx events log`. Ship without it if Gap 02 is not yet ready; backfill events later.
- Pre-commit hook needs an allowlist so `--strategy=lockfile-regen` commits do not trip "unclaimed files" guard mid-resolve.

## Open questions

- Should `gx resolve` operate only inside the agent worktree, or also on the primary checkout during a finish-time merge conflict? Lean **worktree-only**; primary stays read-only.
- Where does `gx resolve --auto` get its rule set when `.gx/resolve.json` is absent — built-in defaults only, or refuse and require explicit `--strategy`? Lean **built-in defaults for the three named path classes, refuse otherwise**.

## Acceptance criteria

- [ ] `gx resolve <path>` prints the chosen strategy and the exact commands it would run, exits 0, makes no changes.
- [ ] `gx resolve <path> --strategy=submodule-tip` updates `.gitmodules` pointers to the latest remote tip and commits when no submodule is dirty; refuses with a clear error otherwise.
- [ ] `gx resolve <path> --strategy=lockfile-regen` regenerates the lockfile via the registered command and commits the result.
- [ ] `gx resolve --auto` reads `.gx/resolve.json` (or built-in defaults) and resolves every collision in one pass.
- [ ] `--ours` / `--theirs` print a loud warning and still execute.
- [ ] Regression tests cover each strategy against a fixture worktree pair with synthesized collisions.
