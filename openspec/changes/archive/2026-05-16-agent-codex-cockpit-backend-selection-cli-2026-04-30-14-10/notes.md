# cockpit backend selection CLI coverage

## Intent

Lock the existing `gx cockpit --backend` parser and terminal resolver behavior with focused regression coverage.

## Scope

- Keep default `gx cockpit` behavior on the tmux path.
- Prove explicit `--backend tmux` bypasses Kitty even when Kitty is available.
- Prove explicit `--backend kitty` and `--backend auto` route through the selected terminal backend.
- Prove invalid backend names fail with `--backend requires auto, kitty, or tmux`.

## Verification

- `node --test test/cockpit-terminal-backend.test.js test/cockpit-command.test.js`
- `openspec validate --specs`
