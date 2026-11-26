# Adaptive local job queue

Keep Codex and Claude builds from competing for the last usable RAM. Do not
change either OOM daemon or gate the agents themselves.

- [x] Locate both finish preflight entry points and verify that a transient
  user scope preserves the child command and status.
- [x] Detect RAM at npm install; recompute effective RAM and headroom on every
  admission. Expose the same policy as a read-only `gx mem-doctor --json`.
- [x] Share kernel-owned job slots per local user across all worktrees. Use a
  soft per-job systemd scope where available; pass through on unsupported hosts.
- [x] Verify concurrent callers, low-memory deferral, signal/exit handling,
  installed-package discovery, and unchanged preflight failure handling.

The queue wraps foreground jobs only. Do not infer commands from free-form agent
tool payloads or change commands that do not pass through GitGuardex. A real
host-load comparison is a separate step; do not stress an already pressured
workstation to prove the admission logic.
