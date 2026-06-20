## Why

When several `agent/*` lanes run in one cockpit, there is no ambient signal for
*which lane needs a human right now*. `gx agents status` is a poll: you run it
and read text. workmux solves this with live status icons in the tmux window
list (🤖 working / 💬 waiting / ✅ done) plus a jump key that hops to the agent
that just finished or is waiting. gitguardex already stores per-lane session
state but never surfaces a live activity signal or offers a jump.

## What Changes

- Add a canonical lane **activity** model (`working` | `waiting` | `done` |
  `idle`) with icon mapping, on top of the existing session record's `activity`
  field. (`src/agents/activity.js`)
- Add **`gx agents set-status --activity <state>`** (the producer): resolves a
  lane by `--session`, `--branch`, or `--worktree`/cwd, persists the activity,
  and writes a non-destructive status label (`🤖 <lane>`) to that lane's cockpit
  pane title via the recorded terminal backend. Best-effort: a missing or dead
  multiplexer never fails the command.
- Add **`gx agents jump [--waiting|--done] [--print]`**: focuses the cockpit
  pane of the most relevant lane (waiting first, then done, most-recent first),
  or prints its pane target for a tmux keybind.
- Add a non-destructive `setWindowStatus(target, label)` primitive to the tmux
  (pane title via `select-pane -T`) and kitty (`@ set-window-title`) backends.

Out of scope here (documented follow-ups): auto-wiring the producer into
Claude/Codex agent hooks (the `gx claude install` template is owned by another
active lane), a TUI dashboard (W3), and idle-reap/resurrect (W4).

## Impact

- New CLI surface only; no change to the branch/lock/PR safety model.
- Affected: `src/agents/activity.js` (new), `src/cli/commands/agents.js`,
  `src/cli/args.js`, `src/terminal/tmux.js`, `src/terminal/kitty.js`,
  `test/agents-activity.test.js` (new).
- The pane-title surface renders only when the cockpit enables
  `pane-border-status` (tmux); the activity is always persisted regardless, so
  `gx agents status` and `jump` work even without a live multiplexer.
- Until hook auto-wiring lands, `set-status` is invoked manually or by a
  user-added Claude Code hook. To make status live, add to `.claude/settings.json`
  (the `gx claude install` template that owns this is locked by another lane, so
  it is a follow-up):

  ```json
  {
    "hooks": {
      "Notification": [{ "hooks": [{ "type": "command",
        "command": "gx agents set-status --activity waiting" }] }],
      "Stop": [{ "hooks": [{ "type": "command",
        "command": "gx agents set-status --activity done" }] }],
      "UserPromptSubmit": [{ "hooks": [{ "type": "command",
        "command": "gx agents set-status --activity working" }] }]
    }
  }
  ```

  Each hook runs in the lane worktree, so `set-status` resolves the session via
  its cwd fallback. Bind `jump` in `~/.tmux.conf`:
  `bind L run-shell "gx agents jump --print | xargs -r tmux select-pane -t"`.
