## ADDED Requirements

### Requirement: Canonical agent lane activity model
The system SHALL define a canonical set of agent lane activity states —
`working`, `waiting`, `done`, and `idle` — and SHALL map each to a display icon
(default `🤖`, `💬`, `✅`, and `·`). The system SHALL normalize common aliases
(e.g. `busy`/`running` → `working`, `input`/`blocked` → `waiting`,
`complete`/`finished` → `done`) to a canonical state, and SHALL reject any value
that does not normalize to a canonical state.

#### Scenario: Alias normalizes to canonical state
- **WHEN** an activity value `complete` is normalized
- **THEN** the canonical state `done` is returned
- **AND** its display icon is `✅`.

#### Scenario: Unknown activity is rejected
- **WHEN** an activity value `flying` is normalized
- **THEN** an empty (non-canonical) result is returned
- **AND** `gx agents set-status --activity flying` exits non-zero with an error
  naming the valid states.

### Requirement: Set-status producer persists activity and surfaces it
The `gx agents set-status` command SHALL resolve a target lane by `--session`,
`--branch`, or `--worktree` (defaulting to the current working directory's
worktree), SHALL persist the normalized activity onto that lane's session
record, and SHALL write a non-destructive status label of the form
`<icon> <lane>` to the lane's recorded cockpit pane via the recorded terminal
backend. Writing the surface label SHALL be best-effort: if no backend target is
recorded, or the multiplexer is unavailable, the command SHALL still persist the
activity and exit zero.

#### Scenario: Activity persisted and pane labelled
- **WHEN** `gx agents set-status --branch agent/claude/foo --activity waiting`
  runs for a lane whose session records a tmux pane target
- **THEN** the session's `activity` becomes `waiting`
- **AND** the lane's pane title is set to `💬 foo`.

#### Scenario: Surface failure does not fail the command
- **WHEN** `set-status` runs for a lane whose multiplexer is not reachable
- **THEN** the activity is still persisted
- **AND** the command exits zero, noting the surface was skipped.

#### Scenario: No matching lane
- **WHEN** `set-status` cannot resolve a session from the given selectors
- **THEN** the command exits non-zero with a message that no lane matched.

### Requirement: Jump to the lane that needs attention
The `gx agents jump` command SHALL select the lane most in need of attention —
`waiting` lanes before `done` lanes, and among equal priority the most recently
updated first — restricted to lanes that have a recorded cockpit pane target.
`--waiting` and `--done` SHALL restrict the candidate set to that single state.
By default the command SHALL focus the selected lane's pane via the terminal
backend; with `--print` it SHALL instead print the pane target and not focus.

#### Scenario: Waiting beats done
- **WHEN** one lane is `done` (updated later) and another is `waiting` (updated
  earlier) and `gx agents jump` runs
- **THEN** the `waiting` lane is selected.

#### Scenario: Print mode emits the target
- **WHEN** `gx agents jump --print` runs and a candidate exists
- **THEN** the candidate's pane target is printed
- **AND** no focus command is issued.

#### Scenario: Nothing to jump to
- **WHEN** no lane is `waiting` or `done` with a pane target
- **THEN** the command exits non-zero with a "nothing to jump to" message.

### Requirement: Non-destructive backend status primitive
Both the tmux and kitty terminal backends SHALL expose
`setWindowStatus(target, label)` that sets the lane pane's title without
destroying the user's window/session names: tmux via `select-pane -T <label>`
and kitty via `@ set-window-title`.

#### Scenario: tmux sets pane title
- **WHEN** the tmux backend `setWindowStatus('%3', '🤖 foo')` runs
- **THEN** it issues `select-pane -t %3 -T '🤖 foo'`
- **AND** does not rename the window or session.
