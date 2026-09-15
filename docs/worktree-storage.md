# Worktree storage controls

These controls change repository-local GX behavior. They do not upgrade a
globally installed command, remove existing project results, or configure an
external indexer.

## Start only what the task needs

```sh
gx branch start --preview --sparse-exclude results "docs change" codex
gx branch start --new --no-transfer --task-id docs:42 --provision-mode docs \
  --sparse-exclude results --remember-sparse "docs change" codex
```

- Preview reports tracked blob bytes and the largest tracked directories.
  Sparse exclusions are explicit literal directories, not automatic guesses.
- A stable task ID reuses its ready worktree, even if its title changes. Reuse
  does not allocate another quota slot.
- `minimal` and `docs` skip dependency copies, configured provisioning, build/
  index hooks and app preparation. `full` remains the default.
  `GUARDEX_PROVISION_MODE` supplies the same default for provisioning consumers.
- Reusing a worktree does not undo its earlier preparation. Use a new worktree
  to compare preparation modes.
- Approved `postCreate` commands still require exact-list local consent via
  `gx worktree approve-hooks`. A committed configuration is not consent.

## Repository admission quotas

```sh
git config --local multiagent.worktreeMaxCount 8
git config --local multiagent.worktreeMaxBytes 10737418240
git config --local multiagent.worktreeMinFreeBytes 5368709120
gx worktree estimate --json
```

All three limits are optional non-negative integer values; bytes are literal
bytes. Remove a setting with `git config --local --unset <key>`.

New starts check the registered secondary worktree count, allocated worktree
bytes (when requested), and free space on the destination filesystem. Quota
violations stop before checkout, stashing or transfer. Canonical `branch start`,
`pivot` and `agents start` serialize quota admission through the shared Git
directory; direct script invocation does not provide this serialization.

The byte projection is a tracked-blob estimate, **not a filesystem hard quota**.
Directory overhead, filters/LFS expansion, dependency copies and later agent
writes can exceed it. Central stores and the primary checkout are not counted
as secondary worktree bytes. Reflink blocks may be counted conservatively more
than once. Unknown usage is an error, not permission to allocate.

## Shared immutable results and disposable retention

Default PR review artifacts live in the shared Git directory:
`guardex/runs/<UUID>/results/pr-<number>.md`. Every run has a new ID and results
are never overwritten or automatically evicted. Explicit `--artifact` paths
retain their existing behavior. Old project logs/results are not migrated.

Completed runs register their disposable `logs` and `cache` files. Default
review retention keeps at most 64 MiB of eligible disposable files and removes
eligible files at least seven days old. Runs that never explicitly completed,
results, backups, unknown files, symlinks, malformed ownership records and files
changed since completion are protected. Protected data can exceed the budget.

```sh
gx worktree prune-artifacts --max-bytes 67108864 --max-age-ms 604800000
```

The JSON response reports removed file/byte counts. This is rotation of GX's
registered new run logs, not a general-purpose recursive deletion command.

## Dependency snapshots

Dependency directories are no longer linked to another worktree's mutable
environment. Full preparation creates a shared read-only snapshot under
`gx-dependency-snapshots` in the common Git directory, keyed by lockfiles,
manifests, runtime/ABI, platform, architecture and actual content digest.
Every consumer receives private writable copies, using reflinks where supported.
Changes through one consumer cannot alter another consumer or the snapshot.

External symlinks and corrupted snapshots are refused. Python virtual
environments are not relocatable: recreate them with an approved setup command.
Snapshot validation reads dependency contents; it is not a claimed startup-speed
improvement. Without reflink support, copies consume additional space. Snapshots
are not automatically deleted by run-artifact retention.

## Live process ownership and cleanup

Launch commands produced by `gx agents start` run an agent supervisor that writes
a shared per-launch lease: worktree, session, supervisor/child PID, process birth
identity, cwd and a heartbeat every five seconds. Linux uses boot ID and kernel
process start ticks, protecting against PID reuse. A live identity protects the
worktree even if its heartbeat is old or the process changed directories.
Normal exit removes only that launch's lease.

Unknown identity support or unreadable ownership fails closed. On platforms
without process-birth probing, crashed leases require manual investigation.
Heartbeat expiry alone never authorizes deletion. Existing Git, dirty-data,
claim, live-cwd and merge checks remain in force. Manually launched agents not
using this supervisor still receive the existing process/claim protections.

Post-merge cleanup jobs are durable and retried on a later branch start, or:

```sh
gx worktree retry-cleanup
```

## External index limitation (optimization 3)

The proposed immutable base graph plus private branch delta is **not implemented**.
The inspected CodeGraph and Code Review Graph APIs maintain a mutable per-project
database; a shared data directory would not provide safe query composition.
Supporting true overlays requires indexer changes outside GitGuardex. GX does
not silently share their writable databases or claim a directory allocator is
an overlay implementation.
