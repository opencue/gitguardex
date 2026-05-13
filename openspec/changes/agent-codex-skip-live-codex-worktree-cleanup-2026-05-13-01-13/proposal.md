## Why

`gx branch finish --cleanup` (and the underlying `agent-worktree-prune.sh`) deleted the active Codex agent worktree while the Codex TUI was still running inside it. Once the cwd disappeared, Codex tried to refresh skills / run stop hooks and crashed with `No such file or directory (os error 2)` / `failed to reload config`. Operator lost the session and any in-flight unsaved work in that pane.

## What Changes

- Add `has_live_process_in_worktree()` to `templates/scripts/agent-worktree-prune.sh` that walks `/proc/*/cwd` and returns true when any live process's cwd resolves to inside the managed worktree (including the "(deleted)" suffix that appears after a partial unlink).
- Call it from `process_entry()` BEFORE any branch/worktree removal. When a live process is detected, the worktree is skipped and a clear `[agent-worktree-prune] Skipping live process worktree: <path>` line is logged. The `skipped_active` counter is incremented for the summary.
- Add a regression test (`test/doctor.test.js`) that spawns a long-running Node child process inside a detached agent worktree, runs `gx doctor` cleanup, and asserts the worktree is preserved and the log line is emitted.

## Impact

- Affects `templates/scripts/agent-worktree-prune.sh` (the script copied into managed repos by `gx setup`) and the doctor cleanup path it drives.
- No public API change; just a stricter precondition before destructive cleanup.
- Risk: if `/proc` is unavailable (non-Linux), the live-process check returns false and prune behaves exactly as before. Fail-open is the correct posture here — we'd rather over-cleanup on platforms without `/proc` than block all cleanup permanently.
- Rollout: no migration. New behavior takes effect the moment users pick up the updated `agent-worktree-prune.sh` (via `gx setup` / template copy or via a fresh clone of the repo).
