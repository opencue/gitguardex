# dmux-style cockpit — Phase 3: project picker

## Why

Phase 1 wired the `[p]rojects` hotkey, phase 2 added it to the welcome
screen — but pressing `p` still shows a placeholder panel. Phase 3
turns the picker into a real, navigable list of git repos under the
user's workspace, mirroring dmux's "Select Project" overlay.

## What changes

- New `src/cockpit/projects-finder.js`:
  - `findProjects({ roots, repoRoot, fs, env })` — walks roots up to
    depth 2, collects directories that contain a `.git` entry, skips
    common noise (`node_modules`, `.cache`, `.next`, `dist`, etc.),
    de-duplicates, sorts alphabetically by name.
  - `defaultRoots()` — `GUARDEX_PROJECT_ROOTS` env override
    (`:`-separated), else parent-of-repo, then `~/Documents`,
    `~/code`, `~/src`, `~/projects`.
  - `expandHome()` helper for `~` and `~/...`.
- Real `renderProjectsPanel`:
  - Lists all discovered projects with a `>` cursor on the selected
    row and a `*` marker on the row matching the current `repoPath`.
  - Shows the configured root paths and an empty-state hint pointing
    at `GUARDEX_PROJECT_ROOTS`.
  - Footer hints: `Enter: switch`, `r: rescan`, `Esc: back to main`.
- Control state hooks:
  - Pressing `p` (with no lane selected) populates `state.projects` /
    `state.projectsRoots` lazily on first entry; later entries reuse
    the cache.
  - `up`/`down`/`j`/`k` wrap-navigate the list.
  - `Enter` emits `lastIntent = { type: 'project:switch', path, name }`
    and returns to `main` mode.
  - `r` rescans (clears cache and re-walks the roots).

## Impact

- Picker is read-only at the cockpit layer — emitting the intent is
  enough; the host shell or phase-6 wiring can act on the intent
  (re-launch `gx cockpit --target <path>`, etc.).
- New module is fully unit-testable via injectable `fs` (no real disk
  I/O required in CI).
- No safety-model change: branches, worktrees, locks, PR-only finish
  flow are untouched.
- ASCII-only renderer; no unicode glyphs.
