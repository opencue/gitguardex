## Why

- The terminal fleet/cockpit view was too transcript-like: live agent state was mixed with verbose raw details, making it hard to scan which lanes are working, thinking, blocked, done, or stale.
- Operators need a compact board that highlights lane state, finish readiness, branch/task context, and the files/PR evidence needed for follow-up.

## What Changes

- Update the cockpit renderer to present a fleet-style board with state buckets, a summary header, action hints, compact lane rows, and per-lane progress/readiness text.
- Keep the existing text render surface and command flow intact; this change only improves the rendered terminal output.
- Add focused regression coverage for the grouped fleet buckets and retained cockpit details.

## Impact

- Affected surface: `gx cockpit` / default interactive fleet rendering.
- Risk is narrow: output text changes for cockpit snapshots, with no runtime/session schema changes.
- Existing status payload and cockpit state readers remain unchanged.
