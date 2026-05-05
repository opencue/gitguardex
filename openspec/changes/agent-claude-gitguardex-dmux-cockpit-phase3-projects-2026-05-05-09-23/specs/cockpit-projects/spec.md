## ADDED Requirements

### Requirement: Cockpit ships a project picker module
The cockpit SHALL expose a `projects-finder` module that scans
configured workspace roots for git repositories and returns a stable,
de-duplicated list ready for rendering.

#### Scenario: findProjects walks roots and skips ignored dirs
- **WHEN** `findProjects({ roots, fs })` is called against a tree that
  contains git repos under both `roots[0]/recodee` and
  `roots[0]/tools/cli`, plus a `.git` inside `node_modules`
- **THEN** the returned `projects` list contains the two real repos
- **AND** the result does NOT contain any entry under `node_modules`
  (which is in the skip list).

#### Scenario: defaultRoots respects the env override
- **WHEN** `defaultRoots({ env: { GUARDEX_PROJECT_ROOTS: '/a:/b:/a' } })`
  is called
- **THEN** the returned roots are `['/a', '/b']` (de-duplicated, in
  order).

#### Scenario: expandHome expands ~ paths
- **WHEN** `expandHome('~')` is called and `HOME` is set
- **THEN** the result equals `process.env.HOME`.
- **AND** `expandHome('~/projects')` resolves to `<HOME>/projects`.
- **AND** absolute paths are returned unchanged.

### Requirement: Projects mode renders a navigable list with cursor and current markers
The cockpit `projects` mode panel SHALL render every discovered repo
as a row, mark the cursor row with `>`, and mark the row whose path
matches `state.repoPath` with `*`. The footer SHALL list the
`Enter`/`r`/`Esc` hints.

#### Scenario: Project list renders cursor, current marker, and footer
- **WHEN** the cockpit is in `projects` mode with two known projects
  and `repoPath` matching the first project
- **THEN** the rendered panel contains a row matching `>  *  alpha`
- **AND** the second row exists without a cursor (`  beta`)
- **AND** the rendered panel contains `r:` `rescan` and `Esc:` `back to
  main` footer hints.

### Requirement: Projects mode key handlers navigate, rescan, and emit a switch intent
The cockpit key handler SHALL respond to `up`/`down`/`j`/`k` to wrap
through the projects list, to `r` to rescan, to `Enter` to emit a
`project:switch` intent and return to `main`, and to `Esc` to return
to `main` without emitting any intent.

#### Scenario: j and k navigate with wrap-around
- **WHEN** the cockpit is in `projects` mode with three projects and
  `projectsIndex === 0`, and the user presses `j` then `j` then `j`
- **THEN** `projectsIndex` becomes `1`, then `2`, then wraps back to
  `0`.
- **AND** pressing `k` from index `0` wraps to the last project.

#### Scenario: Enter emits project:switch and returns to main
- **WHEN** the cockpit is in `projects` mode with `projectsIndex` on a
  valid project and the user presses `Enter`
- **THEN** the resulting state has `mode === 'main'`
- **AND** `lastIntent` equals `{ type: 'project:switch', path,
  name }` for the selected project.
