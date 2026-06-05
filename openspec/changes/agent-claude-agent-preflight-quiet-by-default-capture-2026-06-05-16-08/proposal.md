## Why

`gx branch finish` runs `scripts/agent-preflight.sh`, whose `run_step` streamed
each check's stdout live. A green `npm test` (`node --test test/*.test.js`) is
hundreds of lines of TAP, so every finish flooded the agent's context with
output it does not need on success. The audit ranked this the top token sink
after the per-turn advisory.

## What Changes

- `run_step` is QUIET by default: it captures each step's combined output,
  prints a one-line `ok (N lines suppressed)` summary on success, and shows only
  the last N lines (default 40) on failure (where the output is useful).
- `GUARDEX_PREFLIGHT_VERBOSE=1` restores live streaming; `GUARDEX_PREFLIGHT_FAIL_TAIL`
  tunes the failure tail length.
- Latent-bug fix: stack detection now keys on an `attempted` counter, not the
  passed-steps `ran` counter, so a single failing step no longer reports "No
  recognized project stack detected" and exits 0 (false pass).

## Impact

- **Affected**: `templates/scripts/agent-preflight.sh` (symlinked from
  `scripts/agent-preflight.sh`). Runs in every `gx branch finish` preflight.
- **Behavior**: green preflights are quiet by default; failures still surface a
  diagnosable tail and still refuse the push. `set -e` safe (capture via `if`).
- Verified by `test/agent-preflight-quiet.test.js` (suppress / verbose / fail-tail).
